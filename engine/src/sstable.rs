//! SSTable ("Sorted String Table")
//!
//! When the memtable (our fast in-memory store) gets full, we "flush" it to a
//! file on disk. That file is an **SSTable**: the keys are written in sorted
//! order and the file never changes again ("immutable"). This is Step 2 of the
//! LSM-tree, and it's what lets the database hold far more data than fits in RAM.
//!
//! Step 4 adds two read-speed boosters to every SSTable:
//!
//!   - a **Bloom filter**: instantly tells `get` "this key is definitely not in
//!     this file," so we can skip reading the file from disk at all.
//!   - a **sparse index**: remembers the byte offset of every Nth key, so `get`
//!     can jump close to a key and scan a tiny slice instead of the whole file.
//!
//! On-disk layout of the whole file:
//!
//!   [ data entries ...        ]   sorted key/value records (the actual data)
//!   [ sparse index ...        ]   every Nth key -> its byte offset in the data
//!   [ bloom filter bytes      ]
//!   [ footer (40 bytes)       ]   offsets + magic, so we can find the pieces
//!
//! Data entry format (all numbers little-endian):
//!   [ key_len: 4 ] [ key ] [ flag: 1 ] [ val_len: 4 ] [ val ]
//!   flag = 1 -> a real value follows ; flag = 0 -> a tombstone (deleted key)
//!
//! Sparse index entry: [ key_len: 4 ] [ key ] [ offset: 8 ]
//!
//! Footer: [ data_end: 8 ] [ bloom_start: 8 ] [ bloom_len: 8 ]
//!         [ entry_count: 8 ] [ magic: 8 bytes ]

use std::fs::File;
use std::io::{self, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use crate::bloom::Bloom;

const FLAG_VALUE: u8 = 1;
const FLAG_TOMBSTONE: u8 = 0;

/// Record a sparse-index point for every this-many data entries.
const INDEX_INTERVAL: u64 = 16;

/// Identifies our file format (and version) at the very end of the file.
const MAGIC: &[u8; 8] = b"NAGASST1";
/// data_end(8) + bloom_start(8) + bloom_len(8) + entry_count(8) + magic(8).
const FOOTER_LEN: u64 = 40;

/// A handle to one immutable, on-disk sorted table, with its index and Bloom
/// filter held in memory for fast lookups.
pub struct SsTable {
    path: PathBuf,
    /// Byte offset where the data region ends (and the index begins).
    data_end: u64,
    /// Sorted sparse index: (key, byte offset of that key in the data region).
    sparse: Vec<(Vec<u8>, u64)>,
    /// Bloom filter over every key in this table.
    bloom: Bloom,
}

impl SsTable {
    /// Write a brand-new SSTable file from sorted `(key, Option<value>)` pairs.
    ///
    /// `None` as the value means a tombstone (the key was deleted). The caller
    /// must pass entries already in sorted key order — a `BTreeMap` iterator
    /// (which the memtable uses) gives us exactly that for free.
    ///
    /// As we write, we build the Bloom filter and the sparse index, then append
    /// them plus a footer. We `sync_all` at the end so the whole file is truly
    /// on disk before the caller throws away the in-memory copy.
    pub fn write<'a, P, I>(path: P, entries: I) -> io::Result<SsTable>
    where
        P: AsRef<Path>,
        I: IntoIterator<Item = (&'a [u8], Option<&'a [u8]>)>,
    {
        let path = path.as_ref().to_path_buf();

        // Collect first so we know how many keys there are (the Bloom filter
        // wants a size up front). A production database would stream instead,
        // but this keeps the code easy to follow and flushes are small.
        let entries: Vec<(&[u8], Option<&[u8]>)> = entries.into_iter().collect();

        let mut bloom = Bloom::new(entries.len());
        let mut sparse: Vec<(Vec<u8>, u64)> = Vec::new();

        // Build the data region in memory, tracking each key's byte offset.
        let mut data: Vec<u8> = Vec::new();
        for (i, (key, value)) in entries.iter().enumerate() {
            if i as u64 % INDEX_INTERVAL == 0 {
                sparse.push((key.to_vec(), data.len() as u64));
            }
            bloom.add(key);
            data.extend_from_slice(&(key.len() as u32).to_le_bytes());
            data.extend_from_slice(key);
            match value {
                Some(val) => {
                    data.push(FLAG_VALUE);
                    data.extend_from_slice(&(val.len() as u32).to_le_bytes());
                    data.extend_from_slice(val);
                }
                None => {
                    data.push(FLAG_TOMBSTONE);
                    data.extend_from_slice(&0u32.to_le_bytes());
                }
            }
        }

        let data_end = data.len() as u64;

        // Serialize the sparse index.
        let mut index_bytes: Vec<u8> = Vec::new();
        for (key, offset) in &sparse {
            index_bytes.extend_from_slice(&(key.len() as u32).to_le_bytes());
            index_bytes.extend_from_slice(key);
            index_bytes.extend_from_slice(&offset.to_le_bytes());
        }

        let bloom_bytes = bloom.to_bytes();
        let bloom_start = data_end + index_bytes.len() as u64;

        // Footer.
        let mut footer = Vec::with_capacity(FOOTER_LEN as usize);
        footer.extend_from_slice(&data_end.to_le_bytes());
        footer.extend_from_slice(&bloom_start.to_le_bytes());
        footer.extend_from_slice(&(bloom_bytes.len() as u64).to_le_bytes());
        footer.extend_from_slice(&(entries.len() as u64).to_le_bytes());
        footer.extend_from_slice(MAGIC);

        // Write everything out and force it to disk.
        let mut file = File::create(&path)?;
        file.write_all(&data)?;
        file.write_all(&index_bytes)?;
        file.write_all(&bloom_bytes)?;
        file.write_all(&footer)?;
        file.sync_all()?;

        Ok(SsTable {
            path,
            data_end,
            sparse,
            bloom,
        })
    }

    /// Open an existing SSTable file, loading its footer, sparse index, and
    /// Bloom filter into memory.
    pub fn open<P: AsRef<Path>>(path: P) -> io::Result<SsTable> {
        let path = path.as_ref().to_path_buf();
        let mut file = File::open(&path)?;
        let file_len = file.metadata()?.len();
        if file_len < FOOTER_LEN {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "SSTable: file too small to contain a footer",
            ));
        }

        // Read and validate the footer.
        file.seek(SeekFrom::End(-(FOOTER_LEN as i64)))?;
        let mut footer = [0u8; FOOTER_LEN as usize];
        file.read_exact(&mut footer)?;
        if &footer[32..40] != MAGIC {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "SSTable: bad magic (not a nagadb SSTable)",
            ));
        }
        let data_end = u64::from_le_bytes(footer[0..8].try_into().unwrap());
        let bloom_start = u64::from_le_bytes(footer[8..16].try_into().unwrap());
        let bloom_len = u64::from_le_bytes(footer[16..24].try_into().unwrap());

        // Read the sparse index region [data_end, bloom_start).
        let index_len = bloom_start - data_end;
        let mut index_bytes = vec![0u8; index_len as usize];
        file.seek(SeekFrom::Start(data_end))?;
        file.read_exact(&mut index_bytes)?;
        let sparse = parse_sparse_index(&index_bytes)?;

        // Read the Bloom filter region.
        let mut bloom_bytes = vec![0u8; bloom_len as usize];
        file.seek(SeekFrom::Start(bloom_start))?;
        file.read_exact(&mut bloom_bytes)?;
        let bloom = Bloom::from_bytes(&bloom_bytes)?;

        Ok(SsTable {
            path,
            data_end,
            sparse,
            bloom,
        })
    }

    /// Look up a single key in this SSTable.
    ///
    /// Returns:
    ///   - `Ok(None)`             -> this key is not in this file at all
    ///   - `Ok(Some(None))`       -> this file says the key is deleted (tombstone)
    ///   - `Ok(Some(Some(val)))`  -> this file has a value for the key
    ///
    /// Fast path: the Bloom filter can rule the key out without touching disk.
    /// Otherwise the sparse index tells us where to start reading, so we scan a
    /// small slice instead of the whole file.
    pub fn get(&self, target: &[u8]) -> io::Result<Option<Option<Vec<u8>>>> {
        // 1. Bloom filter: definitely-not-present keys cost us nothing.
        if !self.bloom.maybe_contains(target) {
            return Ok(None);
        }

        // 2. Sparse index: jump to the last indexed key that is <= target.
        let start = self.seek_offset(target);

        let file = File::open(&self.path)?;
        let mut reader = BufReader::new(file);
        reader.seek(SeekFrom::Start(start))?;
        let mut pos = start;

        // 3. Scan forward through the data region only.
        while pos < self.data_end {
            let (key, value, consumed) = read_entry(&mut reader)?;
            pos += consumed;

            if key.as_slice() == target {
                return Ok(Some(value));
            }
            // Keys are sorted ascending: once we pass the target, it's not here.
            if key.as_slice() > target {
                return Ok(None);
            }
        }
        Ok(None)
    }

    /// Read every `(key, Option<value>)` entry in this SSTable, in sorted order.
    /// Used when merging files together (compaction) or listing everything.
    pub fn load_all(&self) -> io::Result<Vec<(Vec<u8>, Option<Vec<u8>>)>> {
        let file = File::open(&self.path)?;
        let mut reader = BufReader::new(file);
        let mut out = Vec::new();
        let mut pos = 0u64;

        // Only read the data region; stop before the index/bloom/footer.
        while pos < self.data_end {
            let (key, value, consumed) = read_entry(&mut reader)?;
            pos += consumed;
            out.push((key, value));
        }
        Ok(out)
    }

    /// The file this SSTable lives in.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Find the byte offset to start scanning from: the offset of the largest
    /// indexed key that is still <= `target` (or 0 if `target` precedes them).
    fn seek_offset(&self, target: &[u8]) -> u64 {
        // Number of indexed keys that are <= target.
        let count = self
            .sparse
            .partition_point(|(k, _)| k.as_slice() <= target);
        if count == 0 {
            0
        } else {
            self.sparse[count - 1].1
        }
    }
}

/// Parse the serialized sparse index back into (key, offset) pairs.
fn parse_sparse_index(bytes: &[u8]) -> io::Result<Vec<(Vec<u8>, u64)>> {
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < bytes.len() {
        if i + 4 > bytes.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "SSTable index: truncated key length",
            ));
        }
        let key_len = u32::from_le_bytes(bytes[i..i + 4].try_into().unwrap()) as usize;
        i += 4;
        if i + key_len + 8 > bytes.len() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "SSTable index: truncated entry",
            ));
        }
        let key = bytes[i..i + key_len].to_vec();
        i += key_len;
        let offset = u64::from_le_bytes(bytes[i..i + 8].try_into().unwrap());
        i += 8;
        out.push((key, offset));
    }
    Ok(out)
}

/// Read one data entry from `reader`, returning (key, value, bytes_consumed).
fn read_entry<R: Read>(reader: &mut R) -> io::Result<(Vec<u8>, Option<Vec<u8>>, u64)> {
    let key = read_chunk(reader)?;
    let mut consumed = 4 + key.len() as u64;

    let mut flag = [0u8; 1];
    reader.read_exact(&mut flag)?;
    consumed += 1;

    let value = match flag[0] {
        FLAG_VALUE => {
            let val = read_chunk(reader)?;
            consumed += 4 + val.len() as u64;
            Some(val)
        }
        FLAG_TOMBSTONE => {
            let empty = read_chunk(reader)?; // 0-length value field on disk
            consumed += 4 + empty.len() as u64;
            None
        }
        other => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!("SSTable: unknown value flag byte: {other}"),
            ))
        }
    };

    Ok((key, value, consumed))
}

/// Read a length-prefixed chunk: 4 bytes for the length, then that many bytes.
fn read_chunk<R: Read>(reader: &mut R) -> io::Result<Vec<u8>> {
    let mut len_bytes = [0u8; 4];
    reader.read_exact(&mut len_bytes)?;
    let len = u32::from_le_bytes(len_bytes) as usize;
    let mut data = vec![0u8; len];
    reader.read_exact(&mut data)?;
    Ok(data)
}
