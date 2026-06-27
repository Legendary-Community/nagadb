import Link from "next/link";
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import ProjectDashboard from "@/components/ProjectDashboard";
import { DatabaseIcon } from "@/components/icons";
import { getProject } from "@/lib/store";

type Params = { params: Promise<{ id: string }> };

// Always render live so a newly created database is found immediately (don't
// prerender this page at build time, when no databases exist yet).
export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

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
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-accent">
            <DatabaseIcon size={20} />
          </span>
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
              {project.name}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                Active
              </span>
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
                {project.region}
              </span>
              <span className="font-mono text-[11px] text-subtle">
                ID: {project.id}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Modular Tab-Based Dashboard */}
      <ProjectDashboard project={project} />
    </Shell>
  );
}
