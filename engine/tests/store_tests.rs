//! Tests that prove the engine saves, finds, deletes, and — most importantly —
//! never loses data across a "crash" (dropping the Store and re-opening it).

use engine::Store;

/// Make a fresh, unique temporary directory for each test so they don't clash.
fn temp_dir(label: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("engine-test-{label}-{nanos}"));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

#[test]
fn put_and_get() {
    let dir = temp_dir("put-get");
    let mut db = Store::open(&dir).unwrap();

    db.put(b"name", b"Alice").unwrap();
    assert_eq!(db.get(b"name").unwrap(), Some(b"Alice".to_vec()));
    assert_eq!(db.get(b"missing").unwrap(), None);

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn delete_removes_value() {
    let dir = temp_dir("delete");
    let mut db = Store::open(&dir).unwrap();

    db.put(b"k", b"v").unwrap();
    assert_eq!(db.get(b"k").unwrap(), Some(b"v".to_vec()));

    db.delete(b"k").unwrap();
    assert_eq!(db.get(b"k").unwrap(), None);

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn survives_a_crash() {
    let dir = temp_dir("crash");

    // First "session": write data, then drop the store WITHOUT any clean
    // shutdown. This simulates the process being killed / power loss.
    {
        let mut db = Store::open(&dir).unwrap();
        db.put(b"user:1:name", b"Alice").unwrap();
        db.put(b"user:1:age", b"30").unwrap();
        db.put(b"user:2:name", b"Bob").unwrap();
        db.delete(b"user:2:name").unwrap();
        // `db` is dropped here. No flush, no graceful close — just like a crash.
    }

    // Second "session": re-open the SAME folder. Everything must be recovered
    // purely from the WAL on disk.
    let db = Store::open(&dir).unwrap();
    assert_eq!(db.get(b"user:1:name").unwrap(), Some(b"Alice".to_vec()));
    assert_eq!(db.get(b"user:1:age").unwrap(), Some(b"30".to_vec()));
    // The delete must have survived too.
    assert_eq!(db.get(b"user:2:name").unwrap(), None);

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn put_batch_writes_and_survives_a_crash() {
    let dir = temp_dir("put-batch");

    // First "session": write a batch with a single group-commit fsync, then
    // drop the store WITHOUT a clean shutdown (simulates a crash).
    {
        let mut db = Store::open(&dir).unwrap();
        let pairs: Vec<(Vec<u8>, Vec<u8>)> = (0..100)
            .map(|i| (format!("key:{i}").into_bytes(), format!("val:{i}").into_bytes()))
            .collect();
        db.put_batch(&pairs).unwrap();

        // Visible immediately in the same session.
        assert_eq!(db.get(b"key:0").unwrap(), Some(b"val:0".to_vec()));
        assert_eq!(db.get(b"key:99").unwrap(), Some(b"val:99".to_vec()));
        // dropped here — no flush, just like power loss.
    }

    // Second "session": every batched write must be recovered from the WAL.
    let db = Store::open(&dir).unwrap();
    for i in 0..100 {
        let key = format!("key:{i}");
        let want = format!("val:{i}");
        assert_eq!(db.get(key.as_bytes()).unwrap(), Some(want.into_bytes()));
    }

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn last_write_wins() {
    let dir = temp_dir("overwrite");
    let mut db = Store::open(&dir).unwrap();

    db.put(b"k", b"first").unwrap();
    db.put(b"k", b"second").unwrap();
    assert_eq!(db.get(b"k").unwrap(), Some(b"second".to_vec()));

    // And it must still be "second" after a restart.
    drop(db);
    let db = Store::open(&dir).unwrap();
    assert_eq!(db.get(b"k").unwrap(), Some(b"second".to_vec()));

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn flush_creates_sstable_and_keeps_reads_working() {
    let dir = temp_dir("flush");
    let mut db = Store::open(&dir).unwrap();

    db.put(b"a", b"1").unwrap();
    db.put(b"b", b"2").unwrap();
    assert_eq!(db.sstable_count(), 0);

    // Manually flush the memtable to an on-disk SSTable.
    db.flush().unwrap();
    assert_eq!(db.sstable_count(), 1);

    // Reads must now come from the SSTable, since the memtable was cleared.
    assert_eq!(db.get(b"a").unwrap(), Some(b"1".to_vec()));
    assert_eq!(db.get(b"b").unwrap(), Some(b"2".to_vec()));
    assert_eq!(db.get(b"missing").unwrap(), None);

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn newer_data_overrides_flushed_sstable() {
    let dir = temp_dir("override-sstable");
    let mut db = Store::open(&dir).unwrap();

    // Put a value and flush it to disk.
    db.put(b"k", b"old").unwrap();
    db.delete(b"gone").unwrap(); // tombstone for a key we never re-add
    db.put(b"gone", b"temp").unwrap();
    db.delete(b"gone").unwrap();
    db.flush().unwrap();

    // Now overwrite "k" in a fresh memtable and flush again -> second SSTable.
    db.put(b"k", b"new").unwrap();
    db.flush().unwrap();
    assert_eq!(db.sstable_count(), 2);

    // The newest SSTable must win.
    assert_eq!(db.get(b"k").unwrap(), Some(b"new".to_vec()));
    // The deleted key must stay deleted across SSTables.
    assert_eq!(db.get(b"gone").unwrap(), None);

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sstables_reload_after_restart() {
    let dir = temp_dir("reload");

    {
        let mut db = Store::open(&dir).unwrap();
        db.put(b"x", b"10").unwrap();
        db.put(b"y", b"20").unwrap();
        db.flush().unwrap();
        // Add one more change that stays only in the WAL (not flushed).
        db.put(b"z", b"30").unwrap();
    }

    // Re-open: SSTable data (x, y) loads from disk, and z recovers from the WAL.
    let db = Store::open(&dir).unwrap();
    assert_eq!(db.sstable_count(), 1);
    assert_eq!(db.get(b"x").unwrap(), Some(b"10".to_vec()));
    assert_eq!(db.get(b"y").unwrap(), Some(b"20".to_vec()));
    assert_eq!(db.get(b"z").unwrap(), Some(b"30".to_vec()));

    let mut all = db.scan().unwrap();
    all.sort();
    assert_eq!(
        all,
        vec![
            (b"x".to_vec(), b"10".to_vec()),
            (b"y".to_vec(), b"20".to_vec()),
            (b"z".to_vec(), b"30".to_vec()),
        ]
    );

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn auto_flush_triggers_at_threshold() {
    let dir = temp_dir("auto-flush");
    // Flush after every 4 entries.
    let mut db = Store::open_with_threshold(&dir, 4).unwrap();

    db.put(b"a", b"1").unwrap();
    db.put(b"b", b"2").unwrap();
    db.put(b"c", b"3").unwrap();
    assert_eq!(db.sstable_count(), 0); // not yet
    db.put(b"d", b"4").unwrap(); // 4th entry -> auto flush
    assert_eq!(db.sstable_count(), 1);

    // All data still readable after the automatic flush.
    assert_eq!(db.get(b"a").unwrap(), Some(b"1".to_vec()));
    assert_eq!(db.get(b"d").unwrap(), Some(b"4".to_vec()));

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn compaction_merges_sstables_into_one() {
    let dir = temp_dir("compact-merge");
    let mut db = Store::open(&dir).unwrap();

    db.put(b"a", b"1").unwrap();
    db.flush().unwrap();
    db.put(b"b", b"2").unwrap();
    db.flush().unwrap();
    db.put(b"c", b"3").unwrap();
    db.flush().unwrap();
    assert_eq!(db.sstable_count(), 3);

    db.compact().unwrap();
    assert_eq!(db.sstable_count(), 1); // three files merged into one

    // All data still readable from the single compacted file.
    assert_eq!(db.get(b"a").unwrap(), Some(b"1".to_vec()));
    assert_eq!(db.get(b"b").unwrap(), Some(b"2".to_vec()));
    assert_eq!(db.get(b"c").unwrap(), Some(b"3".to_vec()));

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn compaction_keeps_newest_and_drops_tombstones() {
    let dir = temp_dir("compact-tombstones");
    let mut db = Store::open(&dir).unwrap();

    // Oldest file: a=old, k=1
    db.put(b"a", b"old").unwrap();
    db.put(b"k", b"1").unwrap();
    db.flush().unwrap();

    // Newer file: a overwritten, k deleted
    db.put(b"a", b"new").unwrap();
    db.delete(b"k").unwrap();
    db.flush().unwrap();
    assert_eq!(db.sstable_count(), 2);

    db.compact().unwrap();
    assert_eq!(db.sstable_count(), 1);

    // Newest value wins; the deleted key stays gone.
    assert_eq!(db.get(b"a").unwrap(), Some(b"new".to_vec()));
    assert_eq!(db.get(b"k").unwrap(), None);

    // The compacted file should contain only the one live entry.
    assert_eq!(db.scan().unwrap(), vec![(b"a".to_vec(), b"new".to_vec())]);

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn compaction_survives_restart() {
    let dir = temp_dir("compact-restart");

    {
        let mut db = Store::open(&dir).unwrap();
        db.put(b"x", b"10").unwrap();
        db.flush().unwrap();
        db.put(b"y", b"20").unwrap();
        db.flush().unwrap();
        db.compact().unwrap();
        assert_eq!(db.sstable_count(), 1);
    }

    // Re-open: the single compacted SSTable loads cleanly from disk.
    let db = Store::open(&dir).unwrap();
    assert_eq!(db.sstable_count(), 1);
    assert_eq!(db.get(b"x").unwrap(), Some(b"10".to_vec()));
    assert_eq!(db.get(b"y").unwrap(), Some(b"20".to_vec()));

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn compaction_with_everything_deleted_leaves_no_file() {
    let dir = temp_dir("compact-empty");
    let mut db = Store::open(&dir).unwrap();

    db.put(b"k", b"v").unwrap();
    db.flush().unwrap();
    db.delete(b"k").unwrap();
    db.flush().unwrap();

    db.compact().unwrap();
    // Nothing alive -> no SSTable file at all.
    assert_eq!(db.sstable_count(), 0);
    assert_eq!(db.get(b"k").unwrap(), None);
    assert!(db.is_empty().unwrap());

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn sparse_index_handles_many_keys() {
    let dir = temp_dir("sparse-index");
    let mut db = Store::open(&dir).unwrap();

    // Far more than the sparse-index interval (16), so the index has several
    // entries and lookups must seek to the right slice.
    for i in 0..200u32 {
        let key = format!("key:{i:04}");
        let value = format!("val:{i}");
        db.put(key.as_bytes(), value.as_bytes()).unwrap();
    }
    db.flush().unwrap();
    assert_eq!(db.sstable_count(), 1);

    // Spot-check keys spread across the file, including the first and last.
    for i in [0u32, 1, 15, 16, 17, 99, 100, 150, 198, 199] {
        let key = format!("key:{i:04}");
        let expected = format!("val:{i}");
        assert_eq!(
            db.get(key.as_bytes()).unwrap(),
            Some(expected.into_bytes()),
            "lookup failed for {key}"
        );
    }

    // A key that sorts in the middle but was never inserted.
    assert_eq!(db.get(b"key:0500").unwrap(), None);

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn bloom_filter_rules_out_missing_keys() {
    let dir = temp_dir("bloom");
    let mut db = Store::open(&dir).unwrap();

    db.put(b"alpha", b"1").unwrap();
    db.put(b"bravo", b"2").unwrap();
    db.put(b"charlie", b"3").unwrap();
    db.flush().unwrap();

    // Present keys still resolve correctly.
    assert_eq!(db.get(b"alpha").unwrap(), Some(b"1".to_vec()));
    assert_eq!(db.get(b"charlie").unwrap(), Some(b"3".to_vec()));

    // Missing keys (Bloom filter should short-circuit most of these) return None.
    for k in [&b"zulu"[..], b"delta", b"echo", b"nope", b"missing"] {
        assert_eq!(db.get(k).unwrap(), None);
    }

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn index_and_bloom_survive_restart() {
    let dir = temp_dir("index-restart");

    {
        let mut db = Store::open(&dir).unwrap();
        for i in 0..50u32 {
            let key = format!("k{i:03}");
            db.put(key.as_bytes(), b"v").unwrap();
        }
        db.flush().unwrap();
    }

    // Re-open: the footer (index + bloom) must load back from disk and work.
    let db = Store::open(&dir).unwrap();
    assert_eq!(db.sstable_count(), 1);
    assert_eq!(db.get(b"k000").unwrap(), Some(b"v".to_vec()));
    assert_eq!(db.get(b"k049").unwrap(), Some(b"v".to_vec()));
    assert_eq!(db.get(b"k999").unwrap(), None);

    std::fs::remove_dir_all(&dir).unwrap();
}
