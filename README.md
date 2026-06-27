# nagadb

A from-scratch, LSM-tree key/value database written in Rust — fast like
Cassandra/ScyllaDB, friendly like MongoDB. Ships with a web console for
creating databases and a JavaScript client SDK.

## Deploy on a VPS — one command

On a fresh **Ubuntu/Debian** server, run:

```bash
curl -fsSL https://raw.githubusercontent.com/Legendary-Community/nagadb/main/deploy/install.sh | sudo bash
```

This installs Rust + Node, builds the engine and the console, and runs both as
systemd services (auto-restart on crash and reboot). When it finishes it prints
the console URL — open it in your browser and click **Create Database**.

To redeploy after pushing new code, just run the same command again.

> Security: the console is served with no login. For production, put it behind a
> reverse proxy (nginx/Caddy) with HTTPS + authentication and only open that port.

## Run locally

Two processes — the storage engine and the web console:

```bash
# terminal 1 — storage engine on http://127.0.0.1:9000
cd api && cargo run --release

# terminal 2 — web console on http://localhost:3000
cd web/naga-console && npm install && npm run dev
```

Open http://localhost:3000 and click **Create Database**.

## Project layout

| Path | What it is |
|------|------------|
| `engine/` | storage core (WAL, memtable, SSTables, compaction, bloom filters, ring) |
| `api/` | std-lib HTTP server + single-DB dashboard, embeds `web/dashboard/` |
| `web/naga-console/` | Next.js multi-database console ("Create Database" → connection URL) |
| `sdk/js/` | JavaScript/TypeScript client (`NagaClient`) |
| `deploy/` | one-command VPS installer |

## Tests & benchmark

```bash
cd engine && cargo test            # engine test suite
cd engine && cargo run --release --bin bench -- 50000   # throughput benchmark
```
