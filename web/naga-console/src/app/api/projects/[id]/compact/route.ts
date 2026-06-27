import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { compactEngine } from "@/lib/engine";
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
    const data = await compactEngine();
    const duration = performance.now() - t0;
    activityLogger.log("COMPACT", "Compaction requested", "Success", duration, `Compacted all SSTables. Consolidated count: ${data.sstables}`);
    return NextResponse.json({ ok: true, sstables: data.sstables });
  } catch (err) {
    const duration = performance.now() - t0;
    const msg = err instanceof Error ? err.message : "compact failed";
    activityLogger.log("COMPACT", "Compaction requested", "Failed", duration, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
