import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { redis } from "@/lib/redis";
import { isJobName, JOBS } from "./jobs";

// Runs one background job now and prints its result: `npm run job poll-presence`.

async function main() {
  const name = process.argv[2] ?? "";
  if (!isJobName(name)) {
    console.error(`Usage: npm run job <${Object.keys(JOBS).join("|")}>`);
    process.exit(2);
  }
  env();
  console.log(JSON.stringify(await JOBS[name].run()));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    redis().disconnect();
  });
