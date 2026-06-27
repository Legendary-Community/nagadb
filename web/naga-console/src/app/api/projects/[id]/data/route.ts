import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import {
  listEntries,
  countEntries,
  putEntry,
  deleteEntry,
  EngineOfflineError,
} from "@/lib/engine";
import { activityLogger } from "@/lib/activity";

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

// GET /api/projects/:id/data?limit=&offset= -> one page of key/value pairs + total
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 500);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
  
  const t0 = performance.now();
  try {
    const [entries, total] = await Promise.all([
      listEntries(id, { limit, offset }),
      countEntries(id),
    ]);
    const duration = performance.now() - t0;
    
    // Log GET query action
    activityLogger.log("GET", `scan(limit:${limit}, offset:${offset})`, "Success", duration, "Range scan on LSM SSTables");
    
    return NextResponse.json({ entries, total, limit, offset });
  } catch (err) {
    const duration = performance.now() - t0;
    activityLogger.log("GET", "scan", "Failed", duration, err instanceof Error ? err.message : "Engine error");
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
  
  const t0 = performance.now();
  try {
    await putEntry(id, key, value);
    const duration = performance.now() - t0;
    
    activityLogger.log("PUT", key, "Success", duration, `Wrote value (${value.length} bytes) to Memtable & WAL`);
    
    return NextResponse.json({ ok: true });
  } catch (err) {
    const duration = performance.now() - t0;
    activityLogger.log("PUT", key, "Failed", duration, err instanceof Error ? err.message : "Engine error");
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
  
  const t0 = performance.now();
  try {
    await deleteEntry(id, key);
    const duration = performance.now() - t0;
    
    activityLogger.log("DELETE", key, "Success", duration, "Tombstone record appended to Memtable & WAL");
    
    return NextResponse.json({ ok: true });
  } catch (err) {
    const duration = performance.now() - t0;
    activityLogger.log("DELETE", key, "Failed", duration, err instanceof Error ? err.message : "Engine error");
    return engineError(err);
  }
}
