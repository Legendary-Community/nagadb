"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import type { Entry } from "@/lib/types";
import { Button } from "./ui";
import {
  SearchIcon,
  RefreshIcon,
  TrashIcon,
  PlusIcon,
  ChevronDownIcon,
  ArrowRightIcon,
} from "./icons";

const PAGE_SIZE = 50;

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

/** Pretty-print a value if it's JSON, otherwise return it unchanged. */
function pretty(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

/**
 * A live, paginated key/value browser for one database. Reads and writes go
 * through the console's API routes, which proxy to the real nagadb engine.
 */
export default function DataBrowser({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(
    async (nextOffset: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/projects/${projectId}/data?limit=${PAGE_SIZE}&offset=${nextOffset}`,
          { cache: "no-store" }
        );
        if (res.status === 503) {
          setOffline(true);
          setEntries([]);
          return;
        }
        const data = await readJsonSafe(res);
        if (!res.ok)
          throw new Error(data?.error ?? `failed to load (HTTP ${res.status})`);
        setOffline(false);
        setEntries(data?.entries ?? []);
        setTotal(data?.total ?? 0);
        setOffset(nextOffset);
      } catch (err) {
        setError(err instanceof Error ? err.message : "failed to load");
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    load(0);
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
      if (!res.ok)
        throw new Error(data?.error ?? `write failed (HTTP ${res.status})`);
      setKey("");
      setValue("");
      setAdding(false);
      await load(0);
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
      if (!res.ok)
        throw new Error(data?.error ?? `delete failed (HTTP ${res.status})`);
      // Stay on the same page, but step back if it just became empty.
      const newTotal = Math.max(total - 1, 0);
      const maxOffset = Math.max(
        Math.floor(Math.max(newTotal - 1, 0) / PAGE_SIZE) * PAGE_SIZE,
        0
      );
      await load(Math.min(offset, maxOffset));
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    }
  }

  if (offline) {
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
        <span className="font-semibold text-danger">Engine offline.</span> The
        database server isn&apos;t reachable right now.{" "}
        <button onClick={() => load(offset)} className="text-accent underline">
          Retry
        </button>
      </div>
    );
  }

  const shown = entries.filter(
    (e) => !filter || e.key.includes(filter) || e.value.includes(filter)
  );

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + entries.length, total);

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h3 className="text-[15px] font-semibold tracking-tight">Data</h3>
          <span className="rounded-full border border-border bg-surface px-2.5 py-0.5 text-[12px] tabular-nums text-muted">
            {total.toLocaleString()} {total === 1 ? "key" : "keys"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-56 max-w-full">
            <SearchIcon
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle"
            />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter this page…"
              className="h-9 w-full rounded-lg border border-border bg-surface-2 pl-8 pr-3 text-[13px] outline-none transition placeholder:text-subtle focus:border-accent"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => load(offset)}>
            <RefreshIcon size={14} />
            Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setAdding((v) => !v)}>
            <PlusIcon size={15} />
            Add key
          </Button>
        </div>
      </div>

      {/* Add row (collapsible) */}
      {adding && (
        <form
          onSubmit={add}
          className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-2/40 p-3"
        >
          <input
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="key"
            className="h-9 min-w-40 flex-1 rounded-lg border border-border bg-surface px-3 font-mono text-[13px] outline-none transition placeholder:text-subtle focus:border-accent"
          />
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="value"
            className="h-9 min-w-40 flex-[2] rounded-lg border border-border bg-surface px-3 font-mono text-[13px] outline-none transition placeholder:text-subtle focus:border-accent"
          />
          <Button type="submit" variant="primary" size="md" disabled={busy || !key.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="ghost" size="md" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </form>
      )}

      {error && (
        <p className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full table-fixed text-left">
          <thead className="border-b border-border bg-surface-2/60 text-[11px] uppercase tracking-wider text-subtle">
            <tr>
              <th className="w-2/5 px-4 py-2.5 font-medium">Key</th>
              <th className="px-4 py-2.5 font-medium">Value</th>
              <th className="w-12 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-4 py-3">
                    <div className="h-3.5 w-2/3 animate-pulse rounded bg-surface-2" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-3.5 w-4/5 animate-pulse rounded bg-surface-2" />
                  </td>
                  <td />
                </tr>
              ))
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-12 text-center text-[13px] text-muted">
                  {total === 0
                    ? "No data yet. Click “Add key” to insert your first record."
                    : "No matches on this page."}
                </td>
              </tr>
            ) : (
              shown.map((e) => {
                const isOpen = expanded === e.key;
                return (
                  <Fragment key={e.key}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : e.key)}
                      className="group cursor-pointer border-t border-border transition hover:bg-surface-2/40"
                    >
                      <td className="truncate px-4 py-2.5 font-mono text-[12px] text-foreground">
                        <span className="inline-flex max-w-full items-center gap-1.5">
                          <ChevronDownIcon
                            size={13}
                            className={`shrink-0 text-subtle transition-transform ${
                              isOpen ? "" : "-rotate-90"
                            }`}
                          />
                          <span className="truncate">{e.key}</span>
                        </span>
                      </td>
                      <td className="truncate px-4 py-2.5 font-mono text-[12px] text-muted">
                        {e.value}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            remove(e.key);
                          }}
                          title="Delete key"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-subtle opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                        >
                          <TrashIcon size={14} />
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr
                        className="border-t border-border bg-background/40"
                      >
                        <td colSpan={3} className="px-4 py-3">
                          <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[12px] leading-relaxed text-foreground">
                            {pretty(e.value)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      {!loading && total > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[12px] text-muted">
          <span className="tabular-nums">
            Showing <span className="text-foreground">{from.toLocaleString()}</span>–
            <span className="text-foreground">{to.toLocaleString()}</span> of{" "}
            <span className="text-foreground">{total.toLocaleString()}</span>
          </span>
          <div className="flex items-center gap-2">
            <span className="tabular-nums">
              Page {page} of {totalPages.toLocaleString()}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset === 0}
              onClick={() => load(Math.max(offset - PAGE_SIZE, 0))}
            >
              <ArrowRightIcon size={13} className="rotate-180" />
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => load(offset + PAGE_SIZE)}
            >
              Next
              <ArrowRightIcon size={13} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
