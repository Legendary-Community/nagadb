// A tiny end-to-end tour of the nagadb client.
//
// 1. Start the database server first, in another terminal:
//      cd api && cargo run
//    (it listens on http://127.0.0.1:9000)
//
// 2. Then run this file:
//      cd sdk/js && node example.js

import { NagaClient } from "./src/index.js";

const db = new NagaClient("http://127.0.0.1:9000");

async function main() {
  // Make sure the server is up before we start.
  if (!(await db.ping())) {
    console.error("Cannot reach nagadb. Start it with:  cd api && cargo run");
    process.exit(1);
  }

  console.log("Connected to nagadb\n");

  // Write a few values.
  await db.put("user:1", "Alice");
  await db.put("user:2", "Bob");
  await db.put("user:3", "Carol");
  console.log("Wrote 3 users");

  // Read one back.
  console.log("user:1 =", await db.get("user:1")); // Alice

  // Missing keys come back as null.
  console.log("user:99 =", await db.get("user:99")); // null

  // Does a key exist?
  console.log("has user:2 ?", await db.has("user:2")); // true

  // List everything.
  console.log("\nAll entries:");
  for (const { key, value } of await db.scan()) {
    console.log(`  ${key} -> ${value}`);
  }

  // ...or grab them as a plain object.
  console.log("\nAs object:", await db.toObject());

  // Delete one.
  await db.delete("user:2");
  console.log("\nDeleted user:2. has user:2 ?", await db.has("user:2")); // false

  // Engine maintenance: flush the memtable to disk, then compact.
  console.log("\nStats before flush:", await db.stats());
  await db.flush();
  await db.compact();
  console.log("Stats after flush + compact:", await db.stats());

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
