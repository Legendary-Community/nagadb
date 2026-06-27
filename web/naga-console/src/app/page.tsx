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
          <span className="text-muted">Workspace</span>
          <span className="text-subtle">/</span>
          <span className="font-medium text-foreground">Databases</span>
        </>
      }
      actions={
        <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
          <PlusIcon size={15} />
          New database
        </Button>
      }
    >
      {/* Page heading */}
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Databases</h1>
          <p className="mt-1 text-[13px] text-muted">
            Create a database and connect to it from any app with a single URL.
          </p>
        </div>
        {!loading && projects.length > 0 && (
          <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[12px] text-muted">
            {projects.length} {projects.length === 1 ? "database" : "databases"}
          </span>
        )}
      </div>

      <EngineBanner online={engineOnline} />

      {/* Toolbar */}
      {!loading && projects.length > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <SearchIcon
              size={15}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search databases…"
              className="h-9 w-full rounded-lg border border-border bg-surface pl-8 pr-3 text-[13px] outline-none transition placeholder:text-subtle focus:border-border-strong"
            />
          </div>
        </div>
      )}

      {loading ? (
        <CardSkeletons />
      ) : projects.length === 0 ? (
        <EmptyState onCreate={() => setShowCreate(true)} />
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-[13px] text-muted">
          No databases match “{query}”.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
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
    <div className="mb-5 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/[0.06] px-4 py-3 text-[13px]">
      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-warning" />
      <div className="text-muted">
        <span className="font-medium text-foreground">Engine offline.</span> You
        can still create databases and copy connection URLs, but reading and
        writing data needs the engine running. Start it with{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-foreground">
          cd api &amp;&amp; cargo run
        </code>
        .
      </div>
    </div>
  );
}

function CardSkeletons() {
  return (
    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-[148px] animate-pulse rounded-xl border border-border bg-surface"
        />
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface/40 py-20 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-2 text-accent">
        <DatabaseIcon size={22} />
      </div>
      <div className="text-[15px] font-semibold">No databases yet</div>
      <p className="mb-6 mt-1.5 max-w-sm text-[13px] text-muted">
        Create your first nagadb database. You&apos;ll get a connection URL you
        can drop straight into your app.
      </p>
      <Button variant="primary" size="md" onClick={onCreate}>
        <PlusIcon size={15} />
        Create database
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
    // The card is a link — stop it from navigating when deleting.
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete database "${project.name}"? This cannot be undone.`)) {
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
      className="group relative flex flex-col rounded-xl border border-border bg-surface p-4 transition hover:border-border-strong hover:bg-surface-2/40"
    >
      <button
        onClick={remove}
        disabled={deleting}
        title="Delete database"
        className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-subtle opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100 disabled:opacity-50"
      >
        <TrashIcon size={15} />
      </button>

      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-accent">
          <DatabaseIcon size={16} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-foreground">
            {project.name}
          </div>
          <div className="truncate font-mono text-[11px] text-subtle">
            {project.id}
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Active
        </span>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
          {project.region}
        </span>
      </div>

      <div className="mt-auto truncate rounded-lg border border-border bg-background/60 px-2.5 py-1.5 font-mono text-[11px] text-muted">
        {project.httpUrl}
      </div>

      <div className="mt-3 flex items-center gap-1 text-[12px] font-medium text-subtle transition group-hover:text-accent">
        Open
        <ArrowRightIcon size={13} />
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
        <h2 className="text-[17px] font-semibold tracking-tight">
          Create database
        </h2>
        <p className="mb-5 mt-1 text-[13px] text-muted">
          Give it a name. We&apos;ll generate a unique ID, an API key, and a
          connection URL.
        </p>

        <label className="mb-1.5 block text-[12px] font-medium text-muted">
          Name
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="my-app-db"
          className="mb-4 h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-[13px] outline-none transition placeholder:text-subtle focus:border-accent"
        />

        <label className="mb-1.5 block text-[12px] font-medium text-muted">
          Region
        </label>
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="mb-5 h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-[13px] outline-none transition focus:border-accent"
        >
          <option value="local-dev">local-dev</option>
          <option value="us-east">us-east</option>
          <option value="eu-west">eu-west</option>
          <option value="ap-south">ap-south</option>
        </select>

        {error && (
          <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={busy || !name.trim()}
          >
            {busy ? "Creating…" : "Create database"}
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
        <div className="mb-1 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-accent">
            <CheckIcon size={15} />
          </span>
          <h2 className="text-[17px] font-semibold tracking-tight">
            <span className="text-accent">{project.name}</span> is ready
          </h2>
        </div>
        <p className="mb-5 text-[13px] text-muted">
          Copy your connection string. The API key is part of it — keep it
          secret.
        </p>

        <ConnectionPanel
          connectionString={project.connectionString}
          httpUrl={project.httpUrl}
          apiKey={project.apiKey}
        />

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose}>
            Done
          </Button>
          <ButtonLink
            variant="primary"
            size="md"
            href={`/projects/${project.id}`}
          >
            Open database
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="rounded-2xl border border-border-strong bg-surface p-6 shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
