import { Worker } from "bullmq";
import { env } from "@/lib/env";
import { refreshStaleSteamGames } from "@/lib/games/service";
import { queue, QUEUE, WORKER_HEARTBEAT_KEY } from "@/lib/queues";
import { redis } from "@/lib/redis";

// Background worker: play detection, notifications, metadata refresh, etc.
// Each feature registers its processors here as it lands.

async function main() {
  env(); // fail fast on bad configuration

  const system = new Worker(
    QUEUE.system,
    async (job) => {
      if (job.name === "heartbeat") {
        await redis().set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), "EX", 180);
      }
    },
    { connection: redis() },
  );

  await queue(QUEUE.system).upsertJobScheduler(
    "heartbeat",
    { every: 60_000 },
    { name: "heartbeat" },
  );

  // Steam metadata (prices, reviews) goes stale; refresh a batch every hour.
  const games = new Worker(
    QUEUE.games,
    async (job) => {
      if (job.name === "refresh-steam") {
        const { checked, refreshed } = await refreshStaleSteamGames();
        if (checked) console.log(`[worker] steam metadata: ${refreshed}/${checked} refreshed`);
      }
    },
    { connection: redis() },
  );
  await queue(QUEUE.games).upsertJobScheduler(
    "refresh-steam",
    { every: 60 * 60_000 },
    { name: "refresh-steam" },
  );

  for (const w of [system, games]) {
    w.on("failed", (job, err) => console.error(`[worker] ${job?.name} failed:`, err));
  }
  console.log("[worker] started");

  const shutdown = async () => {
    console.log("[worker] shutting down");
    await Promise.all([system.close(), games.close()]);
    await redis().quit();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
