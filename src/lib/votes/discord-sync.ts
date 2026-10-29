import { env } from "@/lib/env";
import { QUEUE, queue } from "@/lib/queues";

/** Changes within this window become one edit of the Discord message (rate limits). */
const WINDOW_MS = 2_000;

/**
 * Schedules an update of the round's Discord messages. One job per round per
 * window, run after the window closes, so it sees every change made in it.
 * Never throws: Discord must not break voting on the website.
 */
export async function scheduleDiscordSync(roundId: string) {
  if (!env().DISCORD_BOT_TOKEN) return;
  try {
    const window = Math.floor(Date.now() / WINDOW_MS);
    await queue(QUEUE.notify).add(
      "sync-discord-round",
      { roundId },
      {
        jobId: `sync-discord-round-${roundId}-${window}`,
        delay: (window + 1) * WINDOW_MS - Date.now(),
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  } catch (err) {
    console.error(`[discord] scheduling sync for round ${roundId} failed:`, err);
  }
}
