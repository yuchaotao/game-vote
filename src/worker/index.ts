import { Worker } from "bullmq";
import { env } from "@/lib/env";
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

  system.on("failed", (job, err) => console.error(`[worker] ${job?.name} failed:`, err));
  console.log("[worker] started");

  const shutdown = async () => {
    console.log("[worker] shutting down");
    await system.close();
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
