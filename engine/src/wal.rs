//! Write-Ahead Log (WAL)
//!
//! This is the most important safety feature of the database.
//!
//! The idea is simple: BEFORE we change anything in memory, we first write
//! the change to a file on disk and force it to be saved ("flushed").
//! If the power goes out, we can read this file back when we restart and
//! replay every change — so no data is ever lost.
//!
//! On-disk format for each record (all numbers are little-endian):
//!
//!   [ op: 1 byte ] [ key_len: 4 bytes ] [ key bytes ] [ val_len: 4 bytes ] [ val bytes ]
//!
//!   op = 1  -> PUT (set key = value)
//!   op = 2  -> DELETE (remove key); val_len is 0 and there are no value bytes

use std::fs::{File, OpenOptions};
use std::io::{self, BufReader, Read, Write};
use std::path::Path;

const OP_PUT: u8 = 1;
const OP_DELETE: u8 = 2;

/// One change recorded in the log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WalRecord {
    Put { key: Vec<u8>, value: Vec<u8> },
    Delete { key: Vec<u8> },
}

/// The append-only log file.
///
/// "Append-only" means we only ever add to the END of the file. Adding to the
/// end is the fastest thing a disk can do — this is the secret to fast writes.
pub struct Wal {
    file: File,
}

impl Wal {
    /// Open (or create) the log file at `path`, ready for appending.
    pub fn open<P: AsRef<Path>>(path: P) -> io::Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(path)?;
        Ok(Wal { file })
    }

    /// Write one record to the end of the log and flush it to the physical disk.
    ///
    /// `sync_all` is what guarantees the data is *really* on the disk platter/SSD,
    /// not just sitting in a temporary buffer. This is what makes a crash safe.
    pub fn append(&mut self, record: &WalRecord) -> io::Result<()> {
        let mut buf: Vec<u8> = Vec::new();
        encode_record(record, &mut buf);
        self.file.write_all(&buf)?;
        self.file.sync_all()?; // force it to the actual disk
        Ok(())
    }

    /// Write MANY records with a **single** disk flush at the end ("group commit").
    ///
    /// This is the secret to fast writes. A physical `fsync` costs roughly the
    /// same whether it saves 1 record or 10,000 — it is dominated by the time the
    /// SSD takes to confirm the data is safe (a few milliseconds). By packing all
    /// the records into one buffer, writing them in one go, and syncing **once**,
    /// we pay that millisecond cost a single time for the whole batch instead of
    /// once per key. That turns a few-hundred-writes/sec ceiling into tens or
    /// hundreds of thousands of writes/sec, while keeping the exact same crash
    /// safety: either the whole batch is durably on disk, or (after a crash) the
    /// records that were not yet synced simply never happened.
    pub fn append_batch(&mut self, records: &[WalRecord]) -> io::Result<()> {
        if records.is_empty() {
            return Ok(());
        }
        let mut buf: Vec<u8> = Vec::new();
        for record in records {
            encode_record(record, &mut buf);
        }
        self.file.write_all(&buf)?;
        self.file.sync_all()?; // ONE flush for the entire batch
        Ok(())
    }

    /// Empty the log.
    ///
    /// Called right after the memtable has been flushed to an SSTable: at that
    /// point every change in the log is also safely on disk inside the SSTable,
    /// so the log's job is done and it can start fresh. We `sync_all` so the
    /// emptying itself survives a crash.
    pub fn truncate(&mut self) -> io::Result<()> {
        self.file.set_len(0)?;
        self.file.sync_all()?;
        Ok(())
    }

    /// Read back every record from the start of the log.
    /// Used when the database starts up, to rebuild its memory after a restart.
    pub fn replay<P: AsRef<Path>>(path: P) -> io::Result<Vec<WalRecord>> {
        let file = match File::open(path) {
            Ok(f) => f,
            // No log file yet means a brand-new, empty database.
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e),
        };
        let mut reader = BufReader::new(file);
        let mut records = Vec::new();

        loop {
            let mut op = [0u8; 1];
            // Try to read the next op byte. If we hit the end of the file, we're done.
            match reader.read_exact(&mut op) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break,
                Err(e) => return Err(e),
            }

            let key = read_chunk(&mut reader)?;
            let value = read_chunk(&mut reader)?;

            match op[0] {
                OP_PUT => records.push(WalRecord::Put { key, value }),
                OP_DELETE => records.push(WalRecord::Delete { key }),
                other => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("unknown WAL op byte: {other}"),
                    ))
                }
            }
        }

        Ok(records)
    }
}

/// Encode one record into `buf` in the on-disk WAL format. Shared by both the
/// single-record `append` and the batched `append_batch` so the two can never
/// drift out of sync.
fn encode_record(record: &WalRecord, buf: &mut Vec<u8>) {
    match record {
        WalRecord::Put { key, value } => {
            buf.push(OP_PUT);
            buf.extend_from_slice(&(key.len() as u32).to_le_bytes());
            buf.extend_from_slice(key);
            buf.extend_from_slice(&(value.len() as u32).to_le_bytes());
            buf.extend_from_slice(value);
        }
        WalRecord::Delete { key } => {
            buf.push(OP_DELETE);
            buf.extend_from_slice(&(key.len() as u32).to_le_bytes());
            buf.extend_from_slice(key);
            buf.extend_from_slice(&0u32.to_le_bytes());
        }
    }
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
