import IORedis from "ioredis";

// Tests sign up many users from one IP; clear rate-limit counters so repeated
// runs don't trip the (real) limits.
export default async function globalSetup() {
  const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379");
  try {
    // Steam search results are cached; drop any fetched from the real store.
    const keys = [
      ...(await redis.keys("ratelimit:*")),
      ...(await redis.keys("steam:search:*")),
      ...(await redis.keys("igdb:*")),
    ];
    if (keys.length) await redis.del(...keys);
  } finally {
    redis.disconnect();
  }
}
