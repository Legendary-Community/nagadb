// The bridge from the console to the actual nagadb engine (the Rust API server).
//
// Today there is one shared engine. To give each project its own isolated
// database, we namespace every key with the project id:  "db:<id>:<key>".
// The console hides that prefix, so each project looks like its own database.
// When the engine becomes multi-database for real, only this file changes.

import type { Entry } from "./types";

const ENGINE_URL =
  process.env.NAGADB_ENGINE_URL ?? "http://127.0.0.1:9000";

/** Thrown when the engine server can't be reached. */
export class EngineOfflineError extends Error {
  constructor() {
    super("nagadb engine is not reachable");
    this.name = "EngineOfflineError";
  }
}

/** The per-project key prefix that isolates one database from another. */
function prefix(projectId: string): string {
  return `db:${projectId}:`;
}

async function engineFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(ENGINE_URL + path, {
      ...init,
      // Always talk to the engine fresh; never cache.
      cache: "no-store",
    });
  } catch {
    throw new EngineOfflineError();
  }
}

/** Is the engine up? Used to show a friendly status in the UI. */
export async function engineOnline(): Promise<boolean> {
  try {
    const res = await engineFetch("/api/stats");
    return res.ok;
  } catch {
    return false;
  }
}

/** Save a key/value pair inside a project's database. */
export async function putEntry(
  projectId: string,
  key: string,
  value: string
): Promise<void> {
  const body = new URLSearchParams({
    key: prefix(projectId) + key,
    value,
  }).toString();
  const res = await engineFetch("/api/put", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`engine put failed (HTTP ${res.status})`);
}

/** Read one key from a project's database, or null if absent. */
export async function getEntry(
  projectId: string,
  key: string
): Promise<string | null> {
  const query = new URLSearchParams({ key: prefix(projectId) + key }).toString();
  const res = await engineFetch(`/api/get?${query}`);
  if (!res.ok) throw new Error(`engine get failed (HTTP ${res.status})`);
  const data = (await res.json()) as { found: boolean; value: string | null };
  return data.found ? data.value : null;
}

/** Delete one key from a project's database. */
export async function deleteEntry(
  projectId: string,
  key: string
): Promise<void> {
  const body = new URLSearchParams({ key: prefix(projectId) + key }).toString();
  const res = await engineFetch("/api/delete", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`engine delete failed (HTTP ${res.status})`);
}

/** List key/value pairs in a project's database (prefix stripped).
 *
 * `limit`/`offset` page through the data. A database can hold millions of keys;
 * returning them all would be huge and would freeze the browser, so the UI asks
 * for one page at a time. The engine does the prefix filtering, so only this
 * project's keys come back.
 */
export async function listEntries(
  projectId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<Entry[]> {
  const p = prefix(projectId);
  const query = new URLSearchParams({
    prefix: p,
    limit: String(limit),
    offset: String(offset),
  }).toString();
  const res = await engineFetch(`/api/list?${query}`);
  if (!res.ok) throw new Error(`engine list failed (HTTP ${res.status})`);
  const all = (await res.json()) as Entry[];
  return all.map((e) => ({ key: e.key.slice(p.length), value: e.value }));
}

/** How many keys a project's database holds (the real total, not a page). */
export async function countEntries(projectId: string): Promise<number> {
  const query = new URLSearchParams({ prefix: prefix(projectId) }).toString();
  const res = await engineFetch(`/api/count?${query}`);
  if (!res.ok) throw new Error(`engine count failed (HTTP ${res.status})`);
  const data = (await res.json()) as { count: number };
  return data.count ?? 0;
}

/** Get overall engine statistics (total keys and SSTables count). */
export async function getEngineStats(): Promise<{ entries: number; sstables: number }> {
  const res = await engineFetch("/api/stats");
  if (!res.ok) throw new Error(`engine stats failed (HTTP ${res.status})`);
  return (await res.json()) as { entries: number; sstables: number };
}


/** Force a memtable flush on the engine. */
export async function flushEngine(): Promise<{ sstables: number }> {
  const res = await engineFetch("/api/flush", { method: "POST" });
  if (!res.ok) throw new Error(`flush failed (HTTP ${res.status})`);
  return (await res.json()) as { sstables: number };
}

/** Trigger database compaction. */
export async function compactEngine(): Promise<{ sstables: number }> {
  const res = await engineFetch("/api/compact", { method: "POST" });
  if (!res.ok) throw new Error(`compaction failed (HTTP ${res.status})`);
  return (await res.json()) as { sstables: number };
}
