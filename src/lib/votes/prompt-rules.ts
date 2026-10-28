// When to suggest ending the vote because the group is already playing a
// front-runner together (#10). Pure.

import { PRESENCE_FRESH_MS, togetherSegments, type Interval } from "@/lib/play/rules";
import type { Standing } from "./rules";

export const PROMPT_RULE = {
  /** Playing together for longer than this. */
  minTogetherMs: 20 * 60_000,
  /** The game must rank this high (or higher) in the open round. */
  maxRank: 2,
  /** Never fewer than this many players, even in tiny groups. */
  minPlayers: 2,
};

/** "More than half the members", and at least two people. */
export function playersNeeded(memberCount: number): number {
  return Math.max(PROMPT_RULE.minPlayers, Math.floor(memberCount / 2) + 1);
}

export type PastPrompt = { gameId: string; playingSince: Date; status: string };

export type PromptCandidate = {
  gameId: string;
  players: number;
  playingSince: Date;
  rank: number;
};

/**
 * Games that should be prompted now: enough members are playing it together
 * right now, have been for over 20 minutes, and it ranks top 2. A game already
 * prompted in this round is only prompted again after "continue", for a newer
 * play session; and never while another prompt for the round is pending.
 */
export function promptCandidates({
  memberCount,
  intervals,
  standings,
  prompts,
  now = Date.now(),
}: {
  memberCount: number;
  /** Members' play, open sessions ending at their last confirmation. */
  intervals: Interval[];
  standings: Standing[];
  prompts: PastPrompt[];
  now?: number;
}): PromptCandidate[] {
  if (prompts.some((p) => p.status === "PENDING")) return [];
  const needed = playersNeeded(memberCount);
  if (memberCount < needed) return [];
  const rankOf = new Map(standings.map((s) => [s.gameId, s.rank]));

  const live = togetherSegments(intervals, {
    minPlayers: needed,
    minDurationMs: PROMPT_RULE.minTogetherMs + 1,
  }).filter((seg) => seg.end >= now - PRESENCE_FRESH_MS);

  const out: PromptCandidate[] = [];
  for (const seg of live) {
    const rank = rankOf.get(seg.gameId);
    if (rank === undefined || rank > PROMPT_RULE.maxRank) continue;
    const before = prompts.filter((p) => p.gameId === seg.gameId);
    const blocked = before.some(
      (p) => p.status !== "CONTINUED" || p.playingSince.getTime() >= seg.start,
    );
    if (blocked) continue;
    out.push({ gameId: seg.gameId, players: seg.peak, playingSince: new Date(seg.start), rank });
  }
  // One prompt at a time: the best-ranked, then the biggest group.
  return out.sort((a, b) => a.rank - b.rank || b.players - a.players).slice(0, 1);
}
