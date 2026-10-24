import { redis } from "@/lib/redis";

/**
 * Fixed-window counter. Returns true while the caller is under `limit`
 * attempts within `windowSeconds`.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const k = `ratelimit:${key}`;
  const count = await redis().incr(k);
  if (count === 1) await redis().expire(k, windowSeconds);
  return count <= limit;
}
