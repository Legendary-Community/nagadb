//! engine — the storage core of a fast, friendly NoSQL database.
//!
//! This crate currently implements Step 1 of the engine: a crash-safe
//! key/value store built from a Write-Ahead Log (WAL) and an in-memory
//! memtable. This is the foundation that everything else builds on.

pub mod bloom;
pub mod cluster;
pub mod memtable;
pub mod sstable;
pub mod store;
pub mod wal;

pub use cluster::Ring;
pub use sstable::SsTable;
pub use store::Store;
pub use wal::{Wal, WalRecord};
