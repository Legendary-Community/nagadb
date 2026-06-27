import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { getEngineStats, countEntries } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Params = { params: Promise<{ id: string }> };

interface CacheEntry {
  timestamp: number;
  data: {
    online: boolean;
    totalKeys: number;
    sstables: number;
  };
}

// Global stats cache to persist across Next.js dev server updates
const globalForCache = globalThis as unknown as {
  statsCache?: Record<string, CacheEntry>;
};
const statsCache = globalForCache.statsCache ?? {};
if (process.env.NODE_ENV !== "production") {
  globalForCache.statsCache = statsCache;
}

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  if (!(await getProject(id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const now = Date.now();
  const cached = statsCache[id];

  // Cache hit: serve from memory if cache is less than 10 seconds old
  if (cached && now - cached.timestamp < 10000) {
    return NextResponse.json(cached.data);
  }

  try {
    const [stats, keysCount] = await Promise.all([
      getEngineStats(),
      countEntries(id),
    ]);

    const data = {
      online: true,
      totalKeys: keysCount,
      sstables: stats.sstables,
    };

    statsCache[id] = { timestamp: now, data };
    return NextResponse.json(data);
  } catch (err) {
    const data = {
      online: false,
      totalKeys: 0,
      sstables: 0,
    };
    // Cache engine offline state for 3 seconds to avoid spamming a down engine
    statsCache[id] = { timestamp: now - 7000, data };
    return NextResponse.json(data);
  }
}
