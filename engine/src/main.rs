//! A small demo that proves the engine works and survives "crashes".
//!
//! Run it twice:
//!   1st run  -> writes some data, then exits (simulating a crash: we never
//!               cleanly shut down, we just stop).
//!   2nd run  -> opens the same folder and finds the data still there,
//!               recovered from the WAL.

use engine::Store;

fn main() -> std::io::Result<()> {
    let data_dir = "data";

    // Open (or recover) the database living in the ./data folder.
    let mut db = Store::open(data_dir)?;

    println!("== Engine demo ==");
    println!("Opened database in ./{data_dir}");
    println!("Entries recovered from disk: {}", db.len()?);
    println!("SSTable files on disk: {}", db.sstable_count());

    // Show anything that survived from a previous run.
    if let Some(name) = db.get(b"user:1:name")? {
        println!(
            "  Found existing data -> user:1:name = {}",
            String::from_utf8_lossy(&name)
        );
    } else {
        println!("  No existing data yet (this looks like the first run).");
    }

    // Write some fresh data. Each write is safe on disk before we continue.
    println!("\nWriting data...");
    db.put(b"user:1:name", b"Alice")?;
    db.put(b"user:1:age", b"30")?;
    db.put(b"user:2:name", b"Bob")?;

    // Read it straight back from memory (fast).
    println!("Reading it back:");
    print_kv(&db, "user:1:name")?;
    print_kv(&db, "user:1:age")?;
    print_kv(&db, "user:2:name")?;

    // Delete one and show it's gone.
    db.delete(b"user:2:name")?;
    println!("\nAfter deleting user:2:name:");
    print_kv(&db, "user:2:name")?;

    println!(
        "\nDone. Total live entries: {}\nRun me again and the data will still be here. ✅",
        db.len()?
    );
    Ok(())
}

fn print_kv(db: &Store, key: &str) -> std::io::Result<()> {
    match db.get(key.as_bytes())? {
        Some(value) => println!("  {key} = {}", String::from_utf8_lossy(&value)),
        None => println!("  {key} = (not found)"),
    }
    Ok(())
}
