"use client";

import { useEffect, useState } from "react";
import type { ProjectWithConnection } from "@/lib/types";

interface TransactionEvent {
  op: string;
  key: string;
  status: string;
  duration: string;
  desc: string;
  timestamp: number;
}

interface DBStats {
  online: boolean;
  totalKeys: number;
  sstables: number;
  logs: TransactionEvent[];
  opsRate: number;
}

export default function DatabaseOverview({
  project,
}: {
  project: ProjectWithConnection;
}) {
  const [stats, setStats] = useState<DBStats>({
    online: false,
    totalKeys: 0,
    sstables: 0,
    logs: [],
    opsRate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [chartPoints, setChartPoints] = useState<number[]>(
    Array.from({ length: 15 }, () => 0)
  );

  // Poll stats and real activity logs
  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch(`/api/projects/${project.id}/stats`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = (await res.json()) as DBStats;
          setStats(data);
          
          // Append the real ops rate to the sparkline history
          setChartPoints((prev) => {
            const nextVal = data.online ? Math.max(Math.floor(data.opsRate * 12), 4) : 0;
            return [...prev.slice(1), nextVal];
          });
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 1000); // 1-second refresh for high fidelity
    return () => clearInterval(interval);
  }, [project.id]);

  // SVG Chart path calculation
  const width = 500;
  const height = 120;
  const padding = 10;
  const maxVal = Math.max(...chartPoints, 40);
  const pointsString = chartPoints
    .map((val, index) => {
      const x = padding + (index * (width - padding * 2)) / (chartPoints.length - 1);
      const y = height - padding - (val * (height - padding * 2)) / maxVal;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="space-y-6">
      {/* 3 Metric Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Status card */}
        <div className="flex flex-col justify-between rounded-2xl border border-border bg-surface/50 p-5 shadow-sm backdrop-blur-sm">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-subtle">
            Engine Health
          </span>
          <div className="mt-4 flex items-center gap-3">
            <span
              className={`h-3 w-3 rounded-full ${
                stats.online
                  ? "bg-accent animate-heartbeat shadow-[0_0_8px_var(--accent)]"
                  : "bg-danger"
              }`}
            />
            <span className="text-[18px] font-bold text-foreground">
              {stats.online ? "Online" : "Offline"}
            </span>
          </div>
          <span className="mt-2 text-[11px] text-muted">
            {stats.online
              ? "Rust API active on port 9000"
              : "Start engine: cd api && cargo run"}
          </span>
        </div>

        {/* Total Keys Card */}
        <div className="flex flex-col justify-between rounded-2xl border border-border bg-surface/50 p-5 shadow-sm backdrop-blur-sm">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-subtle">
            Total Keys
          </span>
          <span className="mt-4 text-[26px] font-extrabold tabular-nums text-foreground">
            {loading ? "—" : stats.totalKeys.toLocaleString()}
          </span>
          <span className="mt-2 text-[11px] text-muted">
            Active unique key-value pairs
          </span>
        </div>

        {/* SSTables count card */}
        <div className="flex flex-col justify-between rounded-2xl border border-border bg-surface/50 p-5 shadow-sm backdrop-blur-sm">
          <span className="text-[12px] font-semibold uppercase tracking-wider text-subtle">
            SSTables on Disk
          </span>
          <span className="mt-4 text-[26px] font-extrabold tabular-nums text-foreground">
            {loading ? "—" : stats.sstables}
          </span>
          <span className="mt-2 text-[11px] text-muted">
            Flushed files (read-optimized)
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Live Performance Monitor */}
        <div className="flex flex-col justify-between rounded-2xl border border-border bg-surface/50 p-5 shadow-sm backdrop-blur-sm lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-[14px] font-bold text-foreground">
                Performance Monitor
              </h3>
              <p className="text-[11px] text-muted">
                Real-time throughput (Operations per second)
              </p>
            </div>
            <div className="text-right">
              <span className="font-mono text-[16px] font-bold text-accent">
                {stats.opsRate}
              </span>
              <span className="text-[11px] text-muted ml-1">OPS</span>
            </div>
          </div>

          <div className="relative w-full rounded-xl bg-background/40 p-2">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-32 text-accent"
              fill="none"
            >
              {/* Grid lines */}
              <line x1="0" y1={height/2} x2={width} y2={height/2} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3 3" />
              <line x1="0" y1={height - 10} x2={width} y2={height - 10} stroke="var(--border)" strokeWidth="0.5" />
              
              {/* Polyline area gradient */}
              <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              <path
                d={`M ${padding} ${height - padding} L ${pointsString} L ${width - padding} ${height - padding} Z`}
                fill="url(#grad)"
              />

              {/* Polyline stroke */}
              <polyline
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={pointsString}
              />
            </svg>
          </div>
        </div>

        {/* Storage Details Summary */}
        <div className="rounded-2xl border border-border bg-surface/50 p-5 shadow-sm backdrop-blur-sm">
          <h3 className="mb-4 text-[14px] font-bold text-foreground">
            Engine Specs
          </h3>
          <div className="space-y-3.5 text-[12px]">
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted">Storage Core</span>
              <span className="font-medium text-foreground">LSM-Tree</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted">Concurrency</span>
              <span className="font-medium text-foreground">ThreadPool (RwLock)</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-muted">Bloom Filters</span>
              <span className="font-medium text-foreground">7 Hashes (~1% FP)</span>
            </div>
            <div className="flex justify-between pb-1">
              <span className="text-muted">Sparse Index</span>
              <span className="font-medium text-foreground">Every 16 keys</span>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Log Table */}
      <div className="rounded-2xl border border-border bg-surface/50 p-5 shadow-sm backdrop-blur-sm">
        <h3 className="mb-3.5 text-[14px] font-bold text-foreground">
          Recent Core Activity
        </h3>
        <div className="overflow-x-auto">
          {stats.logs.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-muted">
              No transactions recorded yet. Modify records in the Data Browser to see activity.
            </div>
          ) : (
            <table className="w-full text-left">
              <thead className="border-b border-border text-[11px] uppercase tracking-wider text-subtle">
                <tr>
                  <th className="py-2.5 font-medium">Operation</th>
                  <th className="py-2.5 font-medium">Target / Key</th>
                  <th className="py-2.5 font-medium">Result</th>
                  <th className="py-2.5 font-medium">Latency</th>
                  <th className="py-2.5 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 text-[12px] font-mono">
                {stats.logs.map((log, idx) => (
                  <tr key={idx} className="text-muted hover:text-foreground">
                    <td className="py-3 font-semibold text-foreground">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${
                          log.op === "PUT"
                            ? "bg-accent/10 text-accent"
                            : log.op === "GET"
                            ? "bg-surface-3 text-muted"
                            : log.op === "DELETE"
                            ? "bg-danger/10 text-danger"
                            : log.op === "COMPACT" || log.op === "FLUSH"
                            ? "bg-warning/10 text-warning"
                            : "bg-surface-2 text-subtle"
                        }`}
                      >
                        {log.op}
                      </span>
                    </td>
                    <td className="py-3 text-foreground truncate max-w-[180px]" title={log.key}>
                      {log.key}
                    </td>
                    <td className="py-3">
                      <span className={log.status === "Success" ? "text-accent" : "text-danger"}>
                        {log.status === "Success" ? "✓ Success" : "✗ Failed"}
                      </span>
                    </td>
                    <td className="py-3 text-foreground">{log.duration}</td>
                    <td className="py-3 text-subtle font-sans">{log.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
