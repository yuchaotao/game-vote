// "Hot" score for a group's games: what the group has been playing and
// voting for lately, plus a short boost for newly added games. Pure.

import { togetherSegments, type Interval } from "@/lib/play/rules";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

export const HOTNESS = {
  /** Only activity within this window counts. */
  windowMs: 14 * DAY,
  /** Activity loses half its weight every week. */
  halfLifeMs: 7 * DAY,
  /** Per hour any member plays. */
  perPlayHour: 10,
  /** Extra per hour of playing together, per player in the session. */
  perTogetherPlayerHour: 20,
  perVote: 15,
  /** Boost for a newly added game, fading to zero over freshMs. */
  fresh: 30,
  freshMs: 7 * DAY,
};

export type Hotness = {
  score: number;
  play: number;
  together: number;
  votes: number;
  fresh: number;
};

const decay = (ageMs: number) => Math.pow(0.5, Math.max(0, ageMs) / HOTNESS.halfLifeMs);

/** Weight of an interval: its hours, decayed by the age of its midpoint. */
const weightedHours = (start: number, end: number, now: number) =>
  ((end - start) / HOUR) * decay(now - (start + end) / 2);

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Scores every game in `gameIds`. `intervals` are group members' play
 * (clipped to the window by the caller or here); `votes` are vote times.
 */
export function hotness(
  gameIds: { gameId: string; addedAt: Date }[],
  intervals: Interval[],
  votes: { gameId: string; castAt: Date }[],
  now = Date.now(),
): Record<string, Hotness> {
  const from = now - HOTNESS.windowMs;
  const recent = intervals
    .map((i) => ({ ...i, start: Math.max(i.start, from), end: Math.min(i.end, now) }))
    .filter((i) => i.end > i.start);

  const result: Record<string, Hotness> = {};
  for (const { gameId, addedAt } of gameIds) {
    const age = now - addedAt.getTime();
    result[gameId] = {
      score: 0,
      play: 0,
      together: 0,
      votes: 0,
      fresh: age < HOTNESS.freshMs ? HOTNESS.fresh * (1 - age / HOTNESS.freshMs) : 0,
    };
  }

  for (const i of recent) {
    const h = result[i.gameId];
    if (h) h.play += HOTNESS.perPlayHour * weightedHours(i.start, i.end, now);
  }
  for (const seg of togetherSegments(recent)) {
    const h = result[seg.gameId];
    if (h) {
      h.together +=
        HOTNESS.perTogetherPlayerHour * seg.peak * weightedHours(seg.start, seg.end, now);
    }
  }
  for (const v of votes) {
    const h = result[v.gameId];
    const age = now - v.castAt.getTime();
    if (h && age < HOTNESS.windowMs) h.votes += HOTNESS.perVote * decay(age);
  }

  for (const h of Object.values(result)) {
    h.play = round1(h.play);
    h.together = round1(h.together);
    h.votes = round1(h.votes);
    h.fresh = round1(h.fresh);
    h.score = Math.round(h.play + h.together + h.votes + h.fresh);
  }
  return result;
}
