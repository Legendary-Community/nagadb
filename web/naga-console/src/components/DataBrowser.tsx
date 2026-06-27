"use client";

import { useCallback, useEffect, useState } from "react";
import type { Entry } from "@/lib/types";
import { Button } from "./ui";
import { SearchIcon, RefreshIcon, TrashIcon } from "./icons";

/**
 * Parse a response as JSON, but never throw if the body isn't JSON (e.g. an
 * HTML error page). Returns null in that case so callers can fall back to a
 * clean "HTTP <status>" message instead of a cryptic JSON-parse error.
 */
async function readJsonSafe(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * A live key/value browser for one database. It reads and writes through the
 * console's API routes, which proxy to the real nagadb engine.
 */
export default function DataBrowser({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/data`, {
        cache: "no-store",
      });
      if (res.status === 503) {
        setOffline(true);
        setEntries([]);
        return;
      }
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? `failed to load (HTTP ${res.status})`);
      setOffline(false);
      setEntries(data?.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? `write failed (HTTP ${res.status})`);
      setKey("");
      setValue("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "write failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(k: string) {
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/data?key=${encodeURIComponent(k)}`,
        { method: "DELETE" }
      );
      const data = await readJsonSafe(res);
      if (!res.ok) throw new Error(data?.error ?? `delete failed (HTTP ${res.status})`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  if (offline) {
    return (
      <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
        <span className="font-semibold text-danger">Engine offline.</span> Start
        it with{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
          cd api &amp;&amp; cargo run
        </code>{" "}
        then{" "}
        <button onClick={load} className="text-accent underline">
          retry
        </button>
        .
      </div>
    );
  }

  const shown = entries.filter(
    (e) => !filter || e.key.includes(filter) || e.value.includes(filter)
  );

  return (
    <div>
      {/* Add row */}
      <form onSubmit={add} className="mb-4 flex flex-wrap gap-2">
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="key"
          className="h-9 min-w-40 flex-1 rounded-lg border border-border bg-surface-2 px-3 font-mono text-[13px] outline-none transition placeholder:text-subtle focus:border-accent"
        />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="value"
          className="h-9 min-w-40 flex-1 rounded-lg border border-border bg-surface-2 px-3 font-mono text-[13px] outline-none transition placeholder:text-subtle focus:border-accent"
        />
        <Button type="submit" variant="primary" size="md" disabled={busy || !key.trim()}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </form>

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="relative w-72 max-w-full">
          <SearchIcon
            size={15}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search keys or values…"
            className="h-9 w-full rounded-lg border border-border bg-surface-2 pl-8 pr-3 text-[13px] outline-none transition placeholder:text-subtle focus:border-accent"
          />
        </div>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshIcon size={14} />
          Refresh
        </Button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      {!loading && entries.length >= 200 && (
        <p className="mb-3 rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-[12px] text-muted">
          Showing the first {entries.length} keys. This database may hold many
          more — use search to find a specific key.
        </p>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-left">
          <thead className="border-b border-border bg-surface-2/60 text-[11px] uppercase tracking-wider text-subtle">
            <tr>
              <th className="px-4 py-2.5 font-medium">Key</th>
              <th className="px-4 py-2.5 font-medium">Value</th>
              <th className="w-16 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-[13px] text-muted">
                  Loading…
                </td>
              </tr>
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-10 text-center text-[13px] text-muted">
                  {entries.length === 0
                    ? "No data yet. Add your first key above."
                    : "No matches."}
                </td>
              </tr>
            ) : (
              shown.map((e) => (
                <tr
                  key={e.key}
                  className="group border-t border-border transition hover:bg-surface-2/40"
                >
                  <td className="px-4 py-2.5 font-mono text-[12px] text-foreground">
                    {e.key}
                  </td>
                  <td className="max-w-0 truncate px-4 py-2.5 font-mono text-[12px] text-muted">
                    {e.value}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => remove(e.key)}
                      title="Delete key"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-subtle opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
