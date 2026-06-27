import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { flushEngine } from "@/lib/engine";
import { activityLogger } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const t0 = performance.now();
  try {
    const data = await flushEngine();
    const duration = performance.now() - t0;
    activityLogger.log("FLUSH", "Flush requested", "Success", duration, `Active memtable flushed to disk. New SSTable count: ${data.sstables}`);
    return NextResponse.json({ ok: true, sstables: data.sstables });
  } catch (err) {
    const duration = performance.now() - t0;
    const msg = err instanceof Error ? err.message : "flush failed";
    activityLogger.log("FLUSH", "Flush requested", "Failed", duration, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
