import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { compactEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  try {
    const data = await compactEngine();
    return NextResponse.json({ ok: true, sstables: data.sstables });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "compact failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
