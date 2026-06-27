//! bench — a simple, honest benchmark for the nagadb engine.
//!
//! It measures three things against a fresh on-disk store:
//!   1. write throughput  (sequential puts)
//!   2. read throughput   (random gets of keys that exist)
//!   3. scan throughput   (reading every key once)
//!
//! Run it in RELEASE mode to see real numbers — debug builds are far slower:
//!
//!   cargo run --release --bin bench
//!
//! You can override how many operations to run:
//!
//!   cargo run --release --bin bench -- 200000

use engine::Store;
use std::time::Instant;

fn main() -> std::io::Result<()> {
    // How many key/value pairs to write and read. Default 100k.
    let n: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(100_000);

    // Use a throwaway directory so each run starts clean.
    let dir = std::env::temp_dir().join("nagadb-bench");
    let _ = std::fs::remove_dir_all(&dir);

    println!("nagadb benchmark");
    println!("  operations : {n}");
    println!("  data dir   : {}", dir.display());
    println!(
        "  build      : {}",
        if cfg!(debug_assertions) {
            "debug (slow — use --release!)"
        } else {
            "release"
        }
    );
    println!("------------------------------------------------");

    // Pre-build the keys/values so we measure the engine, not formatting.
    let keys: Vec<String> = (0..n).map(|i| format!("key:{i:08}")).collect();
    let value = b"a-reasonably-sized-value-payload-1234567890";

    // Flush threshold high enough to exercise several SSTables during the run.
    let mut store = Store::open_with_threshold(&dir, 10_000)?;

    // ---- writes --------------------------------------------------------
    let t = Instant::now();
    for k in &keys {
        store.put(k.as_bytes(), value)?;
    }
    report("writes (put)", n, t.elapsed());

    // ---- batched writes (group commit) ---------------------------------
    // Same data, but committed in batches with ONE fsync per batch instead of
    // one per key. This is the high-throughput write path.
    let dir2 = std::env::temp_dir().join("nagadb-bench-batch");
    let _ = std::fs::remove_dir_all(&dir2);
    let mut store2 = Store::open_with_threshold(&dir2, 10_000)?;
    let batch_size = 1_000;
    let batch_pairs: Vec<(Vec<u8>, Vec<u8>)> =
        keys.iter().map(|k| (k.as_bytes().to_vec(), value.to_vec())).collect();
    let t = Instant::now();
    for chunk in batch_pairs.chunks(batch_size) {
        store2.put_batch(chunk)?;
    }
    report("writes (batch)", n, t.elapsed());
    let _ = std::fs::remove_dir_all(&dir2);

    // ---- reads (random) ------------------------------------------------
    // A cheap deterministic shuffle so reads aren't in insertion order.
    let t = Instant::now();
    let mut idx = 0usize;
    let mut hits = 0usize;
    for _ in 0..n {
        idx = (idx.wrapping_mul(2_654_435_761).wrapping_add(1)) % n;
        if store.get(keys[idx].as_bytes())?.is_some() {
            hits += 1;
        }
    }
    report("reads (get)", n, t.elapsed());
    assert_eq!(hits, n, "every key should be found");

    // ---- scan ----------------------------------------------------------
    let t = Instant::now();
    let all = store.scan()?;
    report("scan (all)", all.len(), t.elapsed());

    println!("------------------------------------------------");
    println!("  sstables on disk: {}", store.sstable_count());

    let _ = std::fs::remove_dir_all(&dir);
    Ok(())
}

/// Print ops/sec and average latency for a phase.
fn report(label: &str, ops: usize, elapsed: std::time::Duration) {
    let secs = elapsed.as_secs_f64();
    let per_sec = ops as f64 / secs;
    let avg_us = elapsed.as_micros() as f64 / ops as f64;
    println!(
        "  {label:<14} {ops:>8} ops in {secs:>6.3}s  =>  {per_sec:>12.0} ops/sec  ({avg_us:.2} µs/op)"
    );
}
