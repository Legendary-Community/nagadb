//! Store
//!
//! This ties the pieces together into a working, crash-safe key/value store
//! that can also spill data from memory to disk.
//!
//!   write path:  change -> WAL (safe on disk) -> memtable (fast in memory)
//!   flush:       full memtable -> a new sorted SSTable file, then clear memory
//!   read path:   newest memtable -> newest SSTable -> ... -> oldest SSTable
//!   startup:     load existing SSTables, then replay the WAL to rebuild the
//!                memtable exactly as it was
//!
//! This is the heart of an LSM-tree database, the same design Cassandra and
//! ScyllaDB use. Later steps add compaction (merging SSTables), indexes,
//! distribution across machines, and replication.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc::{channel, Receiver, Sender};

use crate::memtable::Memtable;
use crate::sstable::SsTable;
use crate::wal::{Wal, WalRecord};

/// How many entries the memtable may hold before we flush it to disk.
/// (Counts tombstones too. Small enough to be easy to demonstrate.)
const DEFAULT_FLUSH_THRESHOLD: usize = 1024;

/// Messages sent from background threads to the main Store.
pub enum BackgroundMsg {
    FlushComplete { sstable: SsTable },
    FlushFailed(io::Error),
}

/// A single-node, crash-safe key/value store.
pub struct Store {
    wal: Option<Wal>,
    memtable: Memtable,
    imm_memtable: Option<Arc<Memtable>>,
    /// On-disk sorted tables, kept oldest-first. The newest data is at the end.
    sstables: Vec<SsTable>,
    dir: PathBuf,
    /// The sequence number to give the next SSTable we create.
    next_seq: u64,
    /// Flush the memtable to a new SSTable once it reaches this many entries.
    flush_threshold: usize,
    bg_tx: Sender<BackgroundMsg>,
    bg_rx: std::sync::Mutex<Receiver<BackgroundMsg>>,
}


impl Store {
    /// Open a store living in directory `dir`. Creates the directory if needed,
    /// loads any existing SSTables, and recovers recent data by replaying the WAL.
    pub fn open<P: AsRef<Path>>(dir: P) -> io::Result<Self> {
        Self::open_with_threshold(dir, DEFAULT_FLUSH_THRESHOLD)
    }

    /// Same as [`Store::open`], but lets you choose the flush threshold (handy
    /// for tests that want to force a flush with only a few keys).
    pub fn open_with_threshold<P: AsRef<Path>>(dir: P, flush_threshold: usize) -> io::Result<Self> {
        let dir = dir.as_ref().to_path_buf();
        std::fs::create_dir_all(&dir)?;

        // 0. Backwards compatibility: rename log.wal to active.wal if it exists
        let log_wal_path = dir.join("log.wal");
        let active_wal_path = dir.join("active.wal");
        let flushing_wal_path = dir.join("flushing.wal");
        if log_wal_path.exists() && !active_wal_path.exists() {
            std::fs::rename(&log_wal_path, &active_wal_path)?;
        }

        // 1. Find SSTables already on disk and load them oldest-first.
        let (mut sstables, mut next_seq) = load_sstables(&dir)?;

        // 1.5 Recover flushing.wal if it exists (crashed during active flush)
        if flushing_wal_path.exists() {
            let mut recover_mem = Memtable::new();
            for record in Wal::replay(&flushing_wal_path)? {
                match record {
                    WalRecord::Put { key, value } => recover_mem.put(key, value),
                    WalRecord::Delete { key } => recover_mem.delete(key),
                }
            }
            if !recover_mem.is_empty() {
                let path = dir.join(sstable_filename(next_seq));
                let sstable = SsTable::write(&path, recover_mem.iter_all())?;
                sstables.push(sstable);
                next_seq += 1;
            }
            let _ = std::fs::remove_file(&flushing_wal_path);
        }

        // 2. Rebuild the memtable from active.wal.
        let mut memtable = Memtable::new();
        if active_wal_path.exists() {
            for record in Wal::replay(&active_wal_path)? {
                match record {
                    WalRecord::Put { key, value } => memtable.put(key, value),
                    WalRecord::Delete { key } => memtable.delete(key),
                }
            }
        }

        // 3. Open the WAL for new appends.
        let wal = Wal::open(&active_wal_path)?;
        let (bg_tx, bg_rx) = channel();

        Ok(Store {
            wal: Some(wal),
            memtable,
            imm_memtable: None,
            sstables,
            dir,
            next_seq,
            flush_threshold,
            bg_tx,
            bg_rx: std::sync::Mutex::new(bg_rx),
        })
    }

    /// Helper to get a mutable reference to the active WAL.
    fn wal_mut(&mut self) -> &mut Wal {
        self.wal.as_mut().expect("WAL is closed")
    }

    /// Non-blockingly polls background worker channel to check for completed flushes.
    fn process_background_tasks(&mut self) -> io::Result<()> {
        let rx = self.bg_rx.lock().unwrap();
        while let Ok(msg) = rx.try_recv() {
            match msg {
                BackgroundMsg::FlushComplete { sstable } => {
                    self.sstables.push(sstable);
                    self.imm_memtable = None;
                    let flushing_wal_path = self.dir.join("flushing.wal");
                    let _ = std::fs::remove_file(&flushing_wal_path);
                }
                BackgroundMsg::FlushFailed(e) => {
                    return Err(e);
                }
            }
        }
        Ok(())
    }

    /// Set `key = value`. Safe across crashes: written to the WAL first.
    pub fn put(&mut self, key: &[u8], value: &[u8]) -> io::Result<()> {
        self.process_background_tasks()?;
        self.wal_mut().append(&WalRecord::Put {
            key: key.to_vec(),
            value: value.to_vec(),
        })?;
        self.memtable.put(key.to_vec(), value.to_vec());
        self.maybe_flush()
    }

    /// Delete `key`. Safe across crashes: written to the WAL first.
    pub fn delete(&mut self, key: &[u8]) -> io::Result<()> {
        self.process_background_tasks()?;
        self.wal_mut().append(&WalRecord::Delete { key: key.to_vec() })?;
        self.memtable.delete(key.to_vec());
        self.maybe_flush()
    }

    /// Set MANY key/value pairs at once with a **single** disk flush ("group
    /// commit"). This is the high-throughput write path.
    pub fn put_batch(&mut self, pairs: &[(Vec<u8>, Vec<u8>)]) -> io::Result<()> {
        self.process_background_tasks()?;
        if pairs.is_empty() {
            return Ok(());
        }

        // 1. One durable WAL write for the whole batch.
        let records: Vec<WalRecord> = pairs
            .iter()
            .map(|(k, v)| WalRecord::Put {
                key: k.clone(),
                value: v.clone(),
            })
            .collect();
        self.wal_mut().append_batch(&records)?;

        // 2. Apply to the in-memory memtable now that it's safe on disk.
        for (key, value) in pairs {
            self.memtable.put(key.clone(), value.clone());
        }

        // 3. Spill to an SSTable if we've grown past the threshold.
        self.maybe_flush()
    }

    /// Look up `key`. Returns the value, or `None` if missing or deleted.
    pub fn get(&self, key: &[u8]) -> io::Result<Option<Vec<u8>>> {
        // 1. Newest: the in-memory active memtable.
        if let Some(res) = self.memtable.lookup(key) {
            match res {
                Some(value) => return Ok(Some(value.to_vec())),
                None => return Ok(None),
            }
        }

        // 2. The flushing memtable.
        if let Some(ref imm) = self.imm_memtable {
            if let Some(res) = imm.lookup(key) {
                match res {
                    Some(value) => return Ok(Some(value.to_vec())),
                    None => return Ok(None),
                }
            }
        }

        // 3. On-disk SSTables, newest to oldest.
        for sstable in self.sstables.iter().rev() {
            match sstable.get(key)? {
                Some(Some(value)) => return Ok(Some(value)),
                Some(None) => return Ok(None),
                None => {}
            }
        }

        Ok(None)
    }

    /// Return every live (non-deleted) key/value pair, in sorted order.
    pub fn scan(&self) -> io::Result<Vec<(Vec<u8>, Vec<u8>)>> {
        let mut merged: BTreeMap<Vec<u8>, Option<Vec<u8>>> = BTreeMap::new();

        for sstable in &self.sstables {
            for (key, value) in sstable.load_all()? {
                merged.insert(key, value);
            }
        }
        if let Some(ref imm) = self.imm_memtable {
            for (key, value) in imm.iter_all() {
                merged.insert(key.to_vec(), value.map(|v| v.to_vec()));
            }
        }
        for (key, value) in self.memtable.iter_all() {
            merged.insert(key.to_vec(), value.map(|v| v.to_vec()));
        }

        let live = merged
            .into_iter()
            .filter_map(|(k, v)| v.map(|value| (k, value)))
            .collect();
        Ok(live)
    }

    /// Number of live entries across memory and disk.
    pub fn len(&self) -> io::Result<usize> {
        Ok(self.scan()?.len())
    }

    pub fn is_empty(&self) -> io::Result<bool> {
        Ok(self.len()? == 0)
    }

    /// Flush the memtable to a new SSTable if it has grown past the threshold.
    fn maybe_flush(&mut self) -> io::Result<()> {
        if self.memtable.len() >= self.flush_threshold {
            // Apply backpressure: wait for any running background flush to complete.
            while self.imm_memtable.is_some() {
                self.process_background_tasks()?;
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
            self.trigger_background_flush()?;
        }
        Ok(())
    }

    /// Starts an asynchronous background flush task.
    fn trigger_background_flush(&mut self) -> io::Result<()> {
        let active_wal_path = self.dir.join("active.wal");
        let flushing_wal_path = self.dir.join("flushing.wal");

        let imm = Arc::new(std::mem::replace(&mut self.memtable, Memtable::new()));
        self.imm_memtable = Some(Arc::clone(&imm));

        // Rotate WAL
        self.wal = None; // Drop/close active.wal file handle
        std::fs::rename(&active_wal_path, &flushing_wal_path)?;
        self.wal = Some(Wal::open(&active_wal_path)?);

        let tx = self.bg_tx.clone();
        let path = self.dir.join(sstable_filename(self.next_seq));
        self.next_seq += 1;

        std::thread::spawn(move || {
            match SsTable::write(&path, imm.iter_all()) {
                Ok(sstable) => {
                    let _ = tx.send(BackgroundMsg::FlushComplete { sstable });
                }
                Err(e) => {
                    let _ = tx.send(BackgroundMsg::FlushFailed(e));
                }
            }
        });

        Ok(())
    }

    /// Force the current memtable out to a new on-disk SSTable synchronously.
    pub fn flush(&mut self) -> io::Result<()> {
        // Wait for any background flush to complete first
        while self.imm_memtable.is_some() {
            self.process_background_tasks()?;
            std::thread::sleep(std::time::Duration::from_millis(1));
        }

        if self.memtable.is_empty() {
            return Ok(());
        }

        let active_wal_path = self.dir.join("active.wal");
        let flushing_wal_path = self.dir.join("flushing.wal");

        // Rotate WAL
        self.wal = None; // Drop/close active.wal
        std::fs::rename(&active_wal_path, &flushing_wal_path)?;
        self.wal = Some(Wal::open(&active_wal_path)?);

        let path = self.dir.join(sstable_filename(self.next_seq));
        let sstable = SsTable::write(&path, self.memtable.iter_all())?;
        self.sstables.push(sstable);
        self.next_seq += 1;

        self.memtable.clear();
        let _ = std::fs::remove_file(&flushing_wal_path);
        Ok(())
    }

    /// Merge every SSTable into a single fresh one synchronously.
    pub fn compact(&mut self) -> io::Result<()> {
        // Wait for any background flush to complete first
        while self.imm_memtable.is_some() {
            self.process_background_tasks()?;
            std::thread::sleep(std::time::Duration::from_millis(1));
        }

        self.process_background_tasks()?;
        if self.sstables.is_empty() {
            return Ok(());
        }

        // Merge oldest -> newest so newer entries overwrite older ones.
        let mut merged: BTreeMap<Vec<u8>, Option<Vec<u8>>> = BTreeMap::new();
        for sstable in &self.sstables {
            for (key, value) in sstable.load_all()? {
                merged.insert(key, value);
            }
        }

        // Keep only live entries; tombstones are dropped (see doc comment).
        let live: Vec<(Vec<u8>, Vec<u8>)> = merged
            .into_iter()
            .filter_map(|(k, v)| v.map(|val| (k, val)))
            .collect();

        // Remember the old files so we can delete them once the new one is safe.
        let old_paths: Vec<PathBuf> =
            self.sstables.iter().map(|s| s.path().to_path_buf()).collect();

        // Write the single compacted SSTable (skip it entirely if nothing is left
        // alive).
        let mut new_sstables = Vec::new();
        if !live.is_empty() {
            let path = self.dir.join(sstable_filename(self.next_seq));
            let sstable = SsTable::write(
                &path,
                live.iter().map(|(k, v)| (k.as_slice(), Some(v.as_slice()))),
            )?;
            self.next_seq += 1;
            new_sstables.push(sstable);
        }

        // Swap in the compacted result, then remove the now-obsolete old files.
        self.sstables = new_sstables;
        for path in old_paths {
            let _ = std::fs::remove_file(path);
        }
        Ok(())
    }

    /// How many SSTable files currently exist on disk.
    pub fn sstable_count(&self) -> usize {
        self.sstables.len()
    }

    /// Wait for any running background tasks (like flushes) to complete.
    pub fn wait_for_background_tasks(&mut self) -> io::Result<()> {
        while self.imm_memtable.is_some() {
            self.process_background_tasks()?;
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        Ok(())
    }
}

impl Drop for Store {
    fn drop(&mut self) {
        // Safe database closing: wait for any active background flush to finish
        while self.imm_memtable.is_some() {
            let _ = self.process_background_tasks();
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
    }
}

/// The file name for the SSTable with the given sequence number.
/// Zero-padded so a plain alphabetical sort matches numeric order.
fn sstable_filename(seq: u64) -> String {
    format!("sstable-{seq:010}.sst")
}

/// Find existing `sstable-*.sst` files in `dir`, returned oldest-first, along
/// with the next sequence number to use.
fn load_sstables(dir: &Path) -> io::Result<(Vec<SsTable>, u64)> {
    let mut found: Vec<(u64, PathBuf)> = Vec::new();

    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if let Some(seq) = parse_sstable_seq(name) {
            found.push((seq, path));
        }
    }

    found.sort_by_key(|(seq, _)| *seq);
    let next_seq = found.last().map(|(seq, _)| seq + 1).unwrap_or(0);
    let mut sstables = Vec::with_capacity(found.len());
    for (_, path) in found {
        sstables.push(SsTable::open(path)?);
    }
    Ok((sstables, next_seq))
}

/// Parse the sequence number out of `sstable-0000000007.sst` -> `Some(7)`.
fn parse_sstable_seq(name: &str) -> Option<u64> {
    let rest = name.strip_prefix("sstable-")?.strip_suffix(".sst")?;
    rest.parse().ok()
}
