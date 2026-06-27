"use client";

import { useState } from "react";
import type { ProjectWithConnection } from "@/lib/types";
import DeleteDatabaseButton from "./DeleteDatabaseButton";
import { Button } from "./ui";
import { RefreshIcon } from "./icons";

export default function DatabaseSettings({
  project,
}: {
  project: ProjectWithConnection;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  async function handleFlush() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/flush`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Flush failed");
      setMessage({
        text: `Memtable successfully flushed to disk. Total SSTables: ${data.sstables}`,
        type: "success",
      });
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : "Flush failed",
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCompact() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/compact`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Compaction failed");
      setMessage({
        text: `Database compaction successful. Consolidated SSTables count: ${data.sstables}`,
        type: "success",
      });
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : "Compaction failed",
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Manual operations section */}
      <div className="rounded-2xl border border-border bg-surface/50 p-5 shadow-sm backdrop-blur-sm">
        <h3 className="mb-1.5 text-[14px] font-bold text-foreground">
          Database Operations
        </h3>
        <p className="mb-5 text-[12px] text-muted">
          Manually trigger core LSM storage engine events.
        </p>

        {message && (
          <div
            className={`mb-4 rounded-lg border px-3 py-2.5 text-[12px] ${
              message.type === "success"
                ? "border-accent/30 bg-accent/5 text-accent"
                : "border-danger/30 bg-danger/5 text-danger"
            }`}
          >
            {message.type === "success" ? "✓" : "✗"} {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Flush box */}
          <div className="rounded-xl border border-border/60 bg-background/30 p-4 flex flex-col justify-between">
            <div>
              <h4 className="text-[13px] font-bold text-foreground">
                Flush Memtable
              </h4>
              <p className="mt-1 text-[11px] text-muted leading-relaxed">
                Force the active in-memory memtable (active.wal) to write immediately to disk as an immutable SSTable file.
              </p>
            </div>
            <div className="mt-4">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={handleFlush}
                className="w-full sm:w-auto"
              >
                <RefreshIcon size={13} />
                Flush to disk
              </Button>
            </div>
          </div>

          {/* Compact box */}
          <div className="rounded-xl border border-border/60 bg-background/30 p-4 flex flex-col justify-between">
            <div>
              <h4 className="text-[13px] font-bold text-foreground">
                Consolidate & Compact
              </h4>
              <p className="mt-1 text-[11px] text-muted leading-relaxed">
                Merge all existing SSTables into a single file. This purges duplicate keys and permanently removes tombstones.
              </p>
            </div>
            <div className="mt-4">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={handleCompact}
                className="w-full sm:w-auto"
              >
                <RefreshIcon size={13} />
                Run compaction
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="rounded-2xl border border-danger/25 bg-danger/[0.04] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-[14px] font-bold text-danger">Danger Zone</h3>
            <p className="mt-0.5 text-[12px] text-muted leading-relaxed">
              Permanently delete this database and remove it from the console registry. This action is irreversible.
            </p>
          </div>
          <div>
            <DeleteDatabaseButton
              projectId={project.id}
              projectName={project.name}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
