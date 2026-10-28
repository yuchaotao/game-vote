import { refreshStaleIgdbGames, refreshStaleSteamGames } from "@/lib/games/service";
import { sendDueNotifications } from "@/lib/notify/service";
import { pollSteam, tickManualSessions } from "@/lib/play/service";
import { checkPrompts } from "@/lib/votes/prompts";
import { closeDueRounds } from "@/lib/votes/service";
import { QUEUE, WORKER_HEARTBEAT_KEY } from "@/lib/queues";
import { redis } from "@/lib/redis";

type Job = {
  queue: (typeof QUEUE)[keyof typeof QUEUE];
  /** Repeat interval in ms. */
  every: number;
  run: () => Promise<unknown>;
};

// Every recurring background job. The worker schedules them; `npm run job <name>`
// runs one immediately (handy in production and used by e2e tests).
export const JOBS = {
  heartbeat: {
    queue: QUEUE.system,
    every: 60_000,
    run: () => redis().set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), "EX", 180),
  },
  // Steam metadata (prices, reviews) goes stale; refresh a batch every hour.
  // IGDB games are refreshed weekly by the same job.
  "refresh-steam": {
    queue: QUEUE.games,
    every: 60 * 60_000,
    run: async () => {
      const steam = await refreshStaleSteamGames();
      const igdb = await refreshStaleIgdbGames();
      return { checked: steam.checked + igdb.checked, refreshed: steam.refreshed + igdb.refreshed };
    },
  },
  // Who is playing what: Steam status + manual check-ins.
  "poll-presence": {
    queue: QUEUE.play,
    every: 2 * 60_000,
    run: async () => ({ steam: await pollSteam(), manual: await tickManualSessions() }),
  },
  // Votes with a deadline end on time (also checked whenever a round is viewed).
  "close-due-rounds": {
    queue: QUEUE.votes,
    every: 60_000,
    run: closeDueRounds,
  },
  // "You're playing a front-runner together: end the vote?" (after presence polls).
  "check-prompts": {
    queue: QUEUE.votes,
    every: 2 * 60_000,
    run: checkPrompts,
  },
  // Email / Discord notifications. Events also trigger it right away; this
  // sweep picks up retries.
  "send-notifications": {
    queue: QUEUE.notify,
    every: 30_000,
    run: sendDueNotifications,
  },
} satisfies Record<string, Job>;

export type JobName = keyof typeof JOBS;

export function isJobName(name: string): name is JobName {
  return Object.hasOwn(JOBS, name);
}
