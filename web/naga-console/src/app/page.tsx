"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/Shell";
import ConnectionPanel from "@/components/ConnectionPanel";
import { Button, ButtonLink } from "@/components/ui";
import {
  PlusIcon,
  SearchIcon,
  DatabaseIcon,
  TrashIcon,
  ArrowRightIcon,
  CheckIcon,
} from "@/components/icons";
import type { ProjectWithConnection } from "@/lib/types";

export default function HomePage() {
  const [projects, setProjects] = useState<ProjectWithConnection[]>([]);
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [created, setCreated] = useState<ProjectWithConnection | null>(null);
  const [query, setQuery] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      const data = await res.json();
      setProjects(data.projects ?? []);
      setEngineOnline(Boolean(data.engineOnline));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () =>
      projects.filter(
        (p) =>
          !query ||
          p.name.toLowerCase().includes(query.toLowerCase()) ||
          p.id.toLowerCase().includes(query.toLowerCase())
      ),
    [projects, query]
  );

  return (
    <Shell
      active="projects"
      breadcrumb={
        <>
          <span className="text-muted font-semibold">Workspace</span>
          <span className="text-subtle font-medium">/</span>
          <span className="font-bold text-foreground">Databases</span>
        </>
      }
      actions={
        <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
          <PlusIcon size={15} />
          New Database
        </Button>
      }
    >
      {/* Page heading */}
      <div className="mb-7 flex items-end justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <h1 className="text-[24px] font-extrabold tracking-tight text-foreground bg-gradient-to-r from-foreground via-foreground to-muted bg-clip-text">
            Databases
          </h1>
          <p className="mt-1 text-[13px] text-muted font-medium">
            Create, manage, and query your high-performance LSM-tree instances.
          </p>
        </div>
        {!loading && projects.length > 0 && (
          <span className="rounded-full border border-border bg-surface-2/60 px-3.5 py-1 text-[12px] font-bold text-muted select-none">
            {projects.length} {projects.length === 1 ? "database" : "databases"}
          </span>
        )}
      </div>

      <EngineBanner online={engineOnline} />

      {/* Toolbar */}
      {!loading && projects.length > 0 && (
        <div className="mb-5 flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <SearchIcon
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search databases by name or ID…"
              className="h-9.5 w-full rounded-xl border border-border bg-surface/35 pl-9 pr-3 text-[13px] outline-none transition placeholder:text-subtle/80 focus:border-accent/40 focus:ring-1 focus:ring-accent/10"
            />
          </div>
        </div>
      )}

      {loading ? (
        <CardSkeletons />
      ) : projects.length === 0 ? (
        <EmptyState onCreate={() => setShowCreate(true)} />
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-[13px] text-muted font-semibold">
          No databases match “{query}”.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <DatabaseCard key={p.id} project={p} onDeleted={load} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(p) => {
            setShowCreate(false);
            setCreated(p);
            load();
          }}
        />
      )}

      {created && (
        <CreatedModal project={created} onClose={() => setCreated(null)} />
      )}
    </Shell>
  );
}

function EngineBanner({ online }: { online: boolean | null }) {
  if (online === null || online) return null;
  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-warning/25 bg-warning/[0.04] p-4 text-[13px]">
      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-warning animate-pulse" />
      <div className="text-muted leading-relaxed">
        <span className="font-bold text-foreground">Engine Offline.</span> Your databases are registered in the console metadata, but reading/writing keys requires the Rust storage backend to be active. Start the service on port 9000:
        <div className="mt-2 font-mono text-[11px] bg-background/50 border border-border rounded-lg px-3 py-1.5 w-fit text-foreground">
          cd api && cargo run
        </div>
      </div>
    </div>
  );
}

function CardSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-[160px] animate-pulse rounded-2xl border border-border/80 bg-surface/35"
        />
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-surface/15 py-20 text-center backdrop-blur-sm">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface shadow-[0_0_15px_rgba(0,229,153,0.06)] text-accent">
        <DatabaseIcon size={24} />
      </div>
      <div className="text-[16px] font-bold text-foreground">No Databases Found</div>
      <p className="mb-6 mt-2 max-w-sm text-[13px] text-muted leading-relaxed font-medium">
        Deploy your first nagadb database instantly. You&apos;ll get a secure connection string and developer SDK snippet right away.
      </p>
      <Button variant="primary" size="md" onClick={onCreate}>
        <PlusIcon size={15} />
        Create Database
      </Button>
    </div>
  );
}

function DatabaseCard({
  project,
  onDeleted,
}: {
  project: ProjectWithConnection;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  async function remove(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Permanently delete database "${project.name}"? This action is irreversible.`)) {
      return;
    }
    setDeleting(true);
    try {
      await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Link
      href={`/projects/${project.id}`}
      className="group relative flex flex-col rounded-2xl border border-border/80 bg-surface/35 p-5 shadow-sm backdrop-blur-sm transition-all duration-300 hover:border-accent/40 hover:-translate-y-0.5 hover:shadow-[0_4px_22px_rgba(0,229,153,0.05)]"
    >
      {/* Delete button (visible on hover) */}
      <button
        onClick={remove}
        disabled={deleting}
        title="Delete database"
        className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-lg text-subtle opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100 disabled:opacity-50"
      >
        <TrashIcon size={14} />
      </button>

      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface-2 text-accent shadow-sm group-hover:shadow-[0_0_8px_rgba(0,229,153,0.15)] group-hover:border-accent/30 transition-all">
          <DatabaseIcon size={16} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-bold text-foreground leading-tight">
            {project.name}
          </div>
          <div className="truncate font-mono text-[10px] text-subtle mt-0.5">
            ID: {project.id}
          </div>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
          Active
        </span>
        <span className="rounded-full border border-border bg-surface/20 px-2.5 py-0.5 text-[11px] font-semibold text-muted">
          {project.region}
        </span>
      </div>

      <div className="mt-auto truncate rounded-xl border border-border bg-background/50 px-3 py-2 font-mono text-[11px] text-muted">
        {project.httpUrl}
      </div>

      <div className="mt-4 flex items-center gap-1 text-[12px] font-bold text-subtle transition-colors group-hover:text-accent">
        Open Dashboard
        <ArrowRightIcon size={13} className="transform group-hover:translate-x-0.5 transition-transform" />
      </div>
    </Link>
  );
}

function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: ProjectWithConnection) => void;
}) {
  const [name, setName] = useState("");
  const [region, setRegion] = useState("local-dev");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, region }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed to create");
      onCreated(data.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <form onSubmit={submit} className="w-full max-w-md">
        <h2 className="text-[18px] font-extrabold tracking-tight text-foreground">
          Create Database
        </h2>
        <p className="mb-5 mt-1 text-[13px] text-muted font-medium">
          Create an isolated storage instance. We will configure security keys and endpoints automatically.
        </p>

        <label className="mb-2 block text-[11px] font-extrabold uppercase tracking-wider text-muted">
          Database Name
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. users-db"
          className="mb-4 h-9.5 w-full rounded-xl border border-border bg-surface px-3 text-[13px] outline-none transition placeholder:text-subtle/80 focus:border-accent"
        />

        <label className="mb-2 block text-[11px] font-extrabold uppercase tracking-wider text-muted">
          Deployment Region
        </label>
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="mb-6 h-9.5 w-full rounded-xl border border-border bg-surface px-3 text-[13px] outline-none transition focus:border-accent"
        >
          <option value="local-dev">local-dev (default)</option>
          <option value="us-east">US East (Northern Virginia)</option>
          <option value="eu-west">EU West (Ireland)</option>
          <option value="ap-south">AP South (Mumbai)</option>
        </select>

        {error && (
          <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-[12px] text-danger">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={busy || !name.trim()}
          >
            {busy ? "Creating Database…" : "Create Database"}
          </Button>
        </div>
      </form>
    </Overlay>
  );
}

function CreatedModal({
  project,
  onClose,
}: {
  project: ProjectWithConnection;
  onClose: () => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-lg">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-accent shadow-[0_0_8px_rgba(0,229,153,0.2)]">
            <CheckIcon size={14} />
          </span>
          <h2 className="text-[18px] font-extrabold tracking-tight text-foreground">
            Database Created Successfully
          </h2>
        </div>
        <p className="mb-5 text-[13px] text-muted font-medium">
          Make sure to copy your connection URL. The API key is embedded inside it—please keep it secure.
        </p>

        <ConnectionPanel
          connectionString={project.connectionString}
          httpUrl={project.httpUrl}
          apiKey={project.apiKey}
        />

        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" size="md" onClick={onClose}>
            Close
          </Button>
          <ButtonLink
            variant="primary"
            size="md"
            href={`/projects/${project.id}`}
          >
            Open Dashboard
            <ArrowRightIcon size={15} />
          </ButtonLink>
        </div>
      </div>
    </Overlay>
  );
}

function Overlay({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="rounded-3xl border border-border-strong bg-surface/90 p-7 shadow-2xl shadow-black/80 max-w-lg w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
