import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { activityLogger } from "@/lib/activity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const loggerStats = activityLogger.getStats();
  return NextResponse.json({
    logs: loggerStats.logs,
    opsRate: loggerStats.opsRate,
  });
}
