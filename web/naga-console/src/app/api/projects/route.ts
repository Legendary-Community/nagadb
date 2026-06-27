import { NextResponse } from "next/server";
import { listProjects, createProject } from "@/lib/store";
import { engineOnline } from "@/lib/engine";

// GET /api/projects -> list all databases (+ whether the engine is online)
export async function GET() {
  const [projects, online] = await Promise.all([
    listProjects(),
    engineOnline(),
  ]);
  return NextResponse.json({ projects, engineOnline: online });
}

// POST /api/projects -> create a new database, returns it with its connection URL
export async function POST(request: Request) {
  let body: { name?: string; region?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const name = (body.name ?? "").toString().trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const project = await createProject(name, (body.region ?? "").toString());
  return NextResponse.json({ project }, { status: 201 });
}
