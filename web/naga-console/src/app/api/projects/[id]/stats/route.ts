import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { getEngineStats, countEntries, EngineOfflineError } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const [stats, keysCount] = await Promise.all([
      getEngineStats(),
      countEntries(id),
    ]);
    return NextResponse.json({
      online: true,
      totalKeys: keysCount,
      sstables: stats.sstables,
    });
  } catch (err) {
    return NextResponse.json({ online: false, totalKeys: 0, sstables: 0 });
  }
}
