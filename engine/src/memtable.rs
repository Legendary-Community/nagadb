//! Memtable
//!
//! The "memtable" is where recent data lives in memory (RAM) so that reading
//! and writing are extremely fast. It is paired with the WAL: the WAL keeps a
//! safe copy on disk, while the memtable keeps a fast copy in memory.
//!
//! We use a `BTreeMap` (a sorted map). Sorting matters because later, when we
//! flush this data to disk as an "SSTable", having the keys already in sorted
//! order makes saving and searching them much faster.

use std::collections::BTreeMap;

/// An in-memory, sorted key -> value store.
///
/// A deleted key is stored as `None` (called a "tombstone"). We need the
/// tombstone so that a delete can override older data when we later merge
/// memory with on-disk files.
#[derive(Default)]
pub struct Memtable {
    map: BTreeMap<Vec<u8>, Option<Vec<u8>>>,
}

impl Memtable {
    pub fn new() -> Self {
        Memtable {
            map: BTreeMap::new(),
        }
    }

    /// Set `key = value`.
    pub fn put(&mut self, key: Vec<u8>, value: Vec<u8>) {
        self.map.insert(key, Some(value));
    }

    /// Mark `key` as deleted (a tombstone).
    pub fn delete(&mut self, key: Vec<u8>) {
        self.map.insert(key, None);
    }

    /// Look up a key.
    ///
    /// Returns:
    ///   - `Some(value)` if the key exists,
    ///   - `None` if the key was deleted or was never set.
    pub fn get(&self, key: &[u8]) -> Option<&[u8]> {
        match self.map.get(key) {
            Some(Some(value)) => Some(value.as_slice()),
            _ => None,
        }
    }

    /// Look up a key, distinguishing "deleted here" from "not here at all".
    ///
    /// Returns:
    ///   - `None`              -> this memtable has never heard of the key,
    ///   - `Some(None)`        -> the key was deleted here (a tombstone),
    ///   - `Some(Some(value))` -> the key has this value here.
    ///
    /// The store needs this so that a delete held in memory can correctly
    /// override an older value still sitting in an on-disk SSTable.
    pub fn lookup(&self, key: &[u8]) -> Option<Option<&[u8]>> {
        self.map.get(key).map(|v| v.as_deref())
    }

    /// How many entries (including tombstones) are currently held.
    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    /// Walk every live (non-deleted) key/value in sorted order.
    pub fn iter(&self) -> impl Iterator<Item = (&[u8], &[u8])> {
        self.map.iter().filter_map(|(k, v)| match v {
            Some(value) => Some((k.as_slice(), value.as_slice())),
            None => None,
        })
    }

    /// Walk EVERY entry in sorted order, including tombstones (deleted keys).
    /// This is what we flush to an SSTable, because tombstones must be kept.
    pub fn iter_all(&self) -> impl Iterator<Item = (&[u8], Option<&[u8]>)> {
        self.map.iter().map(|(k, v)| (k.as_slice(), v.as_deref()))
    }

    /// Throw away everything. Done right after the contents are safely flushed
    /// to an SSTable on disk.
    pub fn clear(&mut self) {
        self.map.clear();
    }
}
