# nagadb — JavaScript / TypeScript SDK

The official client for [nagadb](../../). It lets any Node.js or browser app talk
to the database with clean method calls instead of raw HTTP.

Works in **Node.js 18+** and modern **browsers** (uses the built-in `fetch`).

## Install

This SDK lives inside the nagadb repo. To use it from another project:

```bash
npm install /path/to/nagadb/sdk/js
```

Or import it directly during development:

```js
import { NagaClient } from "../nagadb/sdk/js/src/index.js";
```

## Quick start

First start the database server (in the repo): `cd api && cargo run`. Then:

```js
import { NagaClient } from "nagadb";

const db = new NagaClient("http://127.0.0.1:9000");

await db.put("user:1", "Alice");
const name = await db.get("user:1");   // "Alice"
const gone = await db.get("user:99");  // null
await db.delete("user:1");
```

## API

| Method | Description |
| --- | --- |
| `new NagaClient(baseUrl?, options?)` | Create a client. Default URL `http://127.0.0.1:9000`. |
| `put(key, value)` | Save a pair (overwrites). |
| `get(key)` | Read a value, or `null` if absent. |
| `has(key)` | `true`/`false` if the key exists. |
| `delete(key)` | Remove a key. |
| `scan()` | All pairs as `[{ key, value }]`, sorted by key. |
| `toObject()` | All pairs as `{ key: value }`. |
| `stats()` | `{ entries, sstables }`. |
| `flush()` | Flush memtable to a new SSTable. |
| `compact()` | Merge all SSTables into one. |
| `ping()` | `true` if the server is reachable. |

`options`: `{ timeoutMs?: number, fetch?: typeof fetch }`.

Failures throw a `NagaError` (with an optional `.status`).

## Run the example

```bash
cd sdk/js
node example.js
```

## TypeScript

Types ship in `index.d.ts` — no setup needed:

```ts
import { NagaClient, Entry, Stats } from "nagadb";

const db = new NagaClient();
const items: Entry[] = await db.scan();
const s: Stats = await db.stats();
```
