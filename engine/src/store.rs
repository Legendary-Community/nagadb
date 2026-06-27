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

use crate::memtable::Memtable;
use crate::sstable::SsTable;
use crate::wal::{Wal, WalRecord};

/// How many entries the memtable may hold before we flush it to disk.
/// (Counts tombstones too. Small enough to be easy to demonstrate.)
const DEFAULT_FLUSH_THRESHOLD: usize = 1024;

/// A single-node, crash-safe key/value store.
pub struct Store {
    wal: Wal,
    memtable: Memtable,
    /// On-disk sorted tables, kept oldest-first. The newest data is at the end.
    sstables: Vec<SsTable>,
    dir: PathBuf,
    /// The sequence number to give the next SSTable we create.
    next_seq: u64,
    /// Flush the memtable to a new SSTable once it reaches this many entries.
    flush_threshold: usize,
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

        // 1. Find SSTables already on disk and load them oldest-first.
        let (sstables, next_seq) = load_sstables(&dir)?;

        // 2. Rebuild the memtable from whatever the WAL still holds (the data
        //    that was written but not yet flushed into an SSTable).
        let wal_path = dir.join("log.wal");
        let mut memtable = Memtable::new();
        for record in Wal::replay(&wal_path)? {
            match record {
                WalRecord::Put { key, value } => memtable.put(key, value),
                WalRecord::Delete { key } => memtable.delete(key),
            }
        }

        // 3. Open the WAL for new appends.
        let wal = Wal::open(&wal_path)?;

        Ok(Store {
            wal,
            memtable,
            sstables,
            dir,
            next_seq,
            flush_threshold,
        })
    }

    /// Set `key = value`. Safe across crashes: written to the WAL first.
    pub fn put(&mut self, key: &[u8], value: &[u8]) -> io::Result<()> {
        self.wal.append(&WalRecord::Put {
            key: key.to_vec(),
            value: value.to_vec(),
        })?;
        self.memtable.put(key.to_vec(), value.to_vec());
        self.maybe_flush()
    }

    /// Delete `key`. Safe across crashes: written to the WAL first.
    pub fn delete(&mut self, key: &[u8]) -> io::Result<()> {
        self.wal.append(&WalRecord::Delete { key: key.to_vec() })?;
        self.memtable.delete(key.to_vec());
        self.maybe_flush()
    }

    /// Set MANY key/value pairs at once with a **single** disk flush ("group
    /// commit"). This is the high-throughput write path.
    ///
    /// Calling [`Store::put`] in a loop fsyncs once per key, so the SSD's
    /// few-millisecond sync latency caps you at a few hundred writes/sec. Here
    /// we record every change in the WAL with one shared fsync, then apply them
    /// all to the memtable. We pay the disk's latency a single time for the
    /// whole batch, so throughput climbs by orders of magnitude — with exactly
    /// the same crash safety as `put` (the batch is durable as a unit before we
    /// touch memory).
    pub fn put_batch(&mut self, pairs: &[(Vec<u8>, Vec<u8>)]) -> io::Result<()> {
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
        self.wal.append_batch(&records)?;

        // 2. Apply to the in-memory memtable now that it's safe on disk.
        for (key, value) in pairs {
            self.memtable.put(key.clone(), value.clone());
        }

        // 3. Spill to an SSTable if we've grown past the threshold.
        self.maybe_flush()
    }

    /// Look up `key`. Returns the value, or `None` if missing or deleted.
    ///
    /// We search newest data first: the memtable, then each SSTable from newest
    /// to oldest. The first place that mentions the key wins — and if that place
    /// is a tombstone, the answer is "deleted" and we stop looking.
    pub fn get(&self, key: &[u8]) -> io::Result<Option<Vec<u8>>> {
        // 1. Newest: the in-memory memtable.
        match self.memtable.lookup(key) {
            Some(Some(value)) => return Ok(Some(value.to_vec())),
            Some(None) => return Ok(None), // tombstone: deleted
            None => {}
        }

        // 2. On-disk SSTables, newest (end of the list) to oldest.
        for sstable in self.sstables.iter().rev() {
            match sstable.get(key)? {
                Some(Some(value)) => return Ok(Some(value)),
                Some(None) => return Ok(None), // tombstone: deleted
                None => {}                     // not in this file; keep looking
            }
        }

        Ok(None)
    }

    /// Return every live (non-deleted) key/value pair, in sorted order.
    ///
    /// This merges all SSTables (oldest first) and finally the memtable, so that
    /// newer values and tombstones correctly override older ones. Used by the
    /// dashboard to list everything in the database.
    pub fn scan(&self) -> io::Result<Vec<(Vec<u8>, Vec<u8>)>> {
        // Build a merged view. Inserting oldest -> newest means newer entries
        // overwrite older ones, which is exactly the LSM rule.
        let mut merged: BTreeMap<Vec<u8>, Option<Vec<u8>>> = BTreeMap::new();

        for sstable in &self.sstables {
            for (key, value) in sstable.load_all()? {
                merged.insert(key, value);
            }
        }
        for (key, value) in self.memtable.iter_all() {
            merged.insert(key.to_vec(), value.map(|v| v.to_vec()));
        }

        // Keep only live entries (drop tombstones).
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
            self.flush()?;
        }
        Ok(())
    }

    /// Force the current memtable out to a new on-disk SSTable, then clear it
    /// and empty the WAL. Safe ordering: the SSTable is fully written and
    /// fsynced BEFORE we touch the WAL, so a crash at any moment loses nothing.
    pub fn flush(&mut self) -> io::Result<()> {
        if self.memtable.is_empty() {
            return Ok(());
        }

        let path = self.dir.join(sstable_filename(self.next_seq));
        let sstable = SsTable::write(&path, self.memtable.iter_all())?;
        self.sstables.push(sstable);
        self.next_seq += 1;

        // The data now lives durably in the SSTable, so memory and the WAL can
        // be reset.
        self.memtable.clear();
        self.wal.truncate()?;
        Ok(())
    }

    /// Merge every SSTable into a single fresh one (Step 3: compaction).
    ///
    /// As files pile up from repeated flushes, reads get slower (they may have
    /// to check every file) and dead data lingers (old overwritten values and
    /// tombstones). Compaction fixes both:
    ///
    ///   - it keeps only the **newest** value for each key, and
    ///   - it **drops tombstones**, which is safe here because after merging
    ///     *all* SSTables there is no older file left for a tombstone to hide.
    ///
    /// Safe ordering: the new merged file is written and fsynced BEFORE the old
    /// files are deleted. If we crash in between, startup simply loads both the
    /// old and new files; the merged file has a higher sequence number so it
    /// still wins, and the duplicated data resolves correctly.
    pub fn compact(&mut self) -> io::Result<()> {
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
        // alive — e.g. everything was deleted).
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
