import { z } from "zod";

// Pure voting logic: round settings, tallies, ranking and replay frames.

export const DEFAULT_MAX_VOTES = 3;
export const MAX_TITLE = 60;

export const roundSettingsSchema = z.object({
  title: z.string().trim().max(MAX_TITLE, `标题最多 ${MAX_TITLE} 字`),
  // An empty field means the default.
  maxVotes: z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce
      .number()
      .int()
      .min(1, "每人至少 1 票")
      .max(10, "每人最多 10 票")
      .default(DEFAULT_MAX_VOTES),
  ),
  /** ISO timestamp from the browser (converted from its local time), or empty. */
  deadline: z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!v) return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: "custom", message: "截止时间无效" });
        return z.NEVER;
      }
      return d;
    }),
});

export type RoundSettings = z.infer<typeof roundSettingsSchema>;

/** Deadline must be in the future and within 30 days. */
export function deadlineError(deadline: Date | null, now = Date.now()): string | null {
  if (!deadline) return null;
  if (deadline.getTime() <= now + 60_000) return "截止时间需要在至少 1 分钟之后";
  if (deadline.getTime() > now + 30 * 24 * 60 * 60_000) return "截止时间不能超过 30 天";
  return null;
}

export type Candidate = { gameId: string; addedAt: Date | string };
export type Ballot = { gameId: string; userId: string };

export type Standing = {
  gameId: string;
  votes: number;
  voterIds: string[];
  /** 1-based; tied games share a rank. */
  rank: number;
};

/**
 * Tallies and ranks candidates: most votes first; ties broken by hot score,
 * then by who was added first. Tied vote counts share a rank (for "top 2").
 */
export function standings(
  candidates: Candidate[],
  ballots: Ballot[],
  hot: Record<string, number> = {},
): Standing[] {
  const voters = new Map<string, string[]>(candidates.map((c) => [c.gameId, []]));
  for (const b of ballots) voters.get(b.gameId)?.push(b.userId);
  const order = new Map(candidates.map((c, i) => [c.gameId, i]));
  const added = (c: Candidate) => new Date(c.addedAt).getTime();
  const sorted = [...candidates].sort(
    (a, b) =>
      voters.get(b.gameId)!.length - voters.get(a.gameId)!.length ||
      (hot[b.gameId] ?? 0) - (hot[a.gameId] ?? 0) ||
      added(a) - added(b) ||
      order.get(a.gameId)! - order.get(b.gameId)!,
  );
  let rank = 0;
  let lastVotes = -1;
  return sorted.map((c, i) => {
    const ids = voters.get(c.gameId)!;
    if (ids.length !== lastVotes) {
      rank = i + 1;
      lastVotes = ids.length;
    }
    return { gameId: c.gameId, votes: ids.length, voterIds: ids, rank };
  });
}

/** The winner: first place with at least one vote. */
export function winnerOf(list: Standing[]): string | null {
  return list[0] && list[0].votes > 0 ? list[0].gameId : null;
}

export type VoteEventKind = "CANDIDATE" | "CAST" | "RETRACT" | "REMOVED";
export type ReplayEvent = {
  userId: string | null;
  gameId: string;
  kind: VoteEventKind;
  at: Date | string;
};

export type ReplayFrame = {
  at: string;
  event: ReplayEvent;
  standings: Standing[];
};

/**
 * Rebuilds the round step by step: one frame per event (candidate added,
 * vote cast or retracted), each with the standings at that moment.
 */
export function replayFrames(events: ReplayEvent[]): ReplayFrame[] {
  const sorted = [...events].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const candidates: Candidate[] = [];
  const ballots = new Map<string, Ballot>();
  return sorted.map((e) => {
    const key = `${e.userId}|${e.gameId}`;
    if (e.kind === "CANDIDATE") {
      if (!candidates.some((c) => c.gameId === e.gameId)) {
        candidates.push({ gameId: e.gameId, addedAt: e.at });
      }
    } else if (e.kind === "REMOVED") {
      const i = candidates.findIndex((c) => c.gameId === e.gameId);
      if (i >= 0) candidates.splice(i, 1);
    } else if (e.kind === "CAST" && e.userId) {
      ballots.set(key, { userId: e.userId, gameId: e.gameId });
    } else {
      ballots.delete(key);
    }
    return {
      at: new Date(e.at).toISOString(),
      event: e,
      standings: standings(candidates, [...ballots.values()]),
    };
  });
}

export type ToggleCheck = { ok: true } | { ok: false; error: string };

/** Whether a user may cast one more vote. */
export function canCast(
  myVotes: string[],
  gameId: string,
  maxVotes: number,
  isCandidate: boolean,
): ToggleCheck {
  if (!isCandidate) return { ok: false, error: "这个游戏不在候选里" };
  if (myVotes.includes(gameId)) return { ok: false, error: "已经投过这个游戏了" };
  if (myVotes.length >= maxVotes) {
    return { ok: false, error: `每人最多 ${maxVotes} 票，先取消一票再投` };
  }
  return { ok: true };
}

export const END_REASON_TEXT = {
  MANUAL: "手动结束",
  NEXT_ROUND: "结束并开启了下一轮",
  DEADLINE: "到达截止时间",
  PROMPT: "检测到大家在一起玩",
} as const;
