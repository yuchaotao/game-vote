import { Worker } from "bullmq";
import { env } from "@/lib/env";
import { queue } from "@/lib/queues";
import { redis } from "@/lib/redis";
import { isJobName, JOBS } from "./jobs";

// Background worker: runs the recurring jobs in ./jobs.ts on their schedules.

async function main() {
  env(); // fail fast on bad configuration

  const queues = [...new Set(Object.values(JOBS).map((j) => j.queue))];
  const workers = queues.map(
    (name) =>
      new Worker(
        name,
        async (job) => {
          if (!isJobName(job.name)) throw new Error(`unknown job ${job.name}`);
          const result = JSON.stringify(await JOBS[job.name].run());
          // Log only runs that did something, not every quiet 2-minute poll.
          if (
            job.name !== "heartbeat" &&
            /"(started|closed|expired|refreshed)":[1-9]/.test(result)
          ) {
            console.log(`[worker] ${job.name} ${result}`);
          }
        },
        { connection: redis() },
      ),
  );
  for (const [name, job] of Object.entries(JOBS)) {
    await queue(job.queue).upsertJobScheduler(name, { every: job.every }, { name });
  }
  for (const w of workers) {
    w.on("failed", (job, err) => console.error(`[worker] ${job?.name} failed:`, err));
  }
  console.log("[worker] started");

  const shutdown = async () => {
    console.log("[worker] shutting down");
    await Promise.all(workers.map((w) => w.close()));
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
