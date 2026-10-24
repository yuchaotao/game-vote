import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { WORKER_HEARTBEAT_KEY } from "@/lib/queues";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

async function check(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  const [database, cache] = await Promise.all([
    check(() => db.$queryRaw`SELECT 1`),
    check(() => redis().ping()),
  ]);
  const workerHeartbeat = cache ? await redis().get(WORKER_HEARTBEAT_KEY) : null;
  const ok = database && cache;

  return NextResponse.json(
    { ok, database, redis: cache, workerHeartbeat },
    { status: ok ? 200 : 503 },
  );
}
