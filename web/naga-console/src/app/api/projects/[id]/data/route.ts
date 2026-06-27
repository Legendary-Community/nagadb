import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import {
  listEntries,
  putEntry,
  deleteEntry,
  EngineOfflineError,
} from "@/lib/engine";

// Always run live (never prerender/cache): this reads the registry + the engine.
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ id: string }> };

// Turn an engine error into a clean HTTP response.
function engineError(err: unknown) {
  if (err instanceof EngineOfflineError) {
    return NextResponse.json(
      { error: "engine offline", hint: "Start it with:  cd api && cargo run" },
      { status: 503 }
    );
  }
  const message = err instanceof Error ? err.message : "engine error";
  return NextResponse.json({ error: message }, { status: 502 });
}

// GET /api/projects/:id/data -> all key/value pairs in this database
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const entries = await listEntries(id);
    return NextResponse.json({ entries });
  } catch (err) {
    return engineError(err);
  }
}

// POST /api/projects/:id/data -> save a key/value pair  { key, value }
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  let body: { key?: string; value?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const key = (body.key ?? "").toString();
  const value = (body.value ?? "").toString();
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  try {
    await putEntry(id, key, value);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return engineError(err);
  }
}

// DELETE /api/projects/:id/data?key=... -> remove a key from this database
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const key = new URL(request.url).searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }
  try {
    await deleteEntry(id, key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return engineError(err);
  }
}
