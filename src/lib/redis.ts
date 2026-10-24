import IORedis from "ioredis";
import { env } from "./env";

const globalForRedis = globalThis as unknown as { redis?: IORedis };

export function redis(): IORedis {
  // BullMQ requires maxRetriesPerRequest: null on shared connections.
  globalForRedis.redis ??= new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null });
  return globalForRedis.redis;
}
