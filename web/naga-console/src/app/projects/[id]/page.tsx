import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import CopyButton from "@/components/CopyButton";
import ConnectionPanel from "@/components/ConnectionPanel";
import DataBrowser from "@/components/DataBrowser";
import DeleteDatabaseButton from "@/components/DeleteDatabaseButton";
import { DatabaseIcon, BoltIcon } from "@/components/icons";
import { getProject } from "@/lib/store";

type Params = { params: Promise<{ id: string }> };

// Always render live so a newly created database is found immediately (don't
// prerender this page at build time, when no databases exist yet).
export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const snippet = `import { NagaClient } from "nagadb";

const db = new NagaClient("${project.httpUrl}");
await db.put("hello", "world");
const v = await db.get("hello"); // "world"`;

  return (
    <Shell
      active="projects"
      breadcrumb={
        <>
          <Link href="/" className="text-muted transition hover:text-foreground">
            Databases
          </Link>
          <span className="text-subtle">/</span>
          <span className="font-medium text-foreground">{project.name}</span>
        </>
      }
    >
      {/* Header */}
      <div className="mb-7 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-accent">
            <DatabaseIcon size={20} />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">
              {project.name}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Active
              </span>
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                {project.region}
              </span>
              <span className="font-mono text-[12px] text-subtle">
                {project.id}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Connection details */}
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-subtle">
            Connection
          </h2>
          <ConnectionPanel
            connectionString={project.connectionString}
            httpUrl={project.httpUrl}
            apiKey={project.apiKey}
          />
        </section>

        {/* SDK snippet */}
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wider text-subtle">
              <BoltIcon size={14} className="text-accent" />
              Connect from your app
            </h2>
            <CopyButton text={snippet} label="Copy" />
          </div>
          <pre className="overflow-x-auto rounded-lg border border-border bg-background/60 p-4 font-mono text-[12px] leading-relaxed text-foreground">
            {snippet}
          </pre>
        </section>
      </div>

      {/* Live data browser */}
      <section className="mt-4 rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-subtle">
          Data
        </h2>
        <DataBrowser projectId={project.id} />
      </section>

      {/* Danger zone */}
      <section className="mt-4 flex items-center justify-between rounded-xl border border-danger/25 bg-danger/[0.04] p-5">
        <div>
          <h2 className="text-[13px] font-semibold text-danger">Danger zone</h2>
          <p className="mt-0.5 text-[12px] text-muted">
            Permanently remove this database from the console.
          </p>
        </div>
        <DeleteDatabaseButton projectId={project.id} projectName={project.name} />
      </section>
    </Shell>
  );
}
