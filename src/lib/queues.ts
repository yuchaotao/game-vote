import { Queue } from "bullmq";
import { redis } from "./redis";

// Queue names shared by the web app (producer) and the worker (consumer).
export const QUEUE = {
  system: "system",
  games: "games",
  play: "play",
} as const;

export const WORKER_HEARTBEAT_KEY = "worker:heartbeat";

const queues = new Map<string, Queue>();

export function queue(name: (typeof QUEUE)[keyof typeof QUEUE]): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redis() });
    queues.set(name, q);
  }
  return q;
}
