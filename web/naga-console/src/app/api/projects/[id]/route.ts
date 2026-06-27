import { NextResponse } from "next/server";
import { getProject, deleteProject } from "@/lib/store";

// Always run live (never prerender/cache): this reads the project registry.
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ id: string }> };

// GET /api/projects/:id -> one database with its connection details
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ project });
}

// DELETE /api/projects/:id -> remove a database from the registry
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const ok = await deleteProject(id);
  if (!ok) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
