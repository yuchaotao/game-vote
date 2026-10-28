// Pure play-detection logic: turning Steam status polls into sessions, and
// sessions into "played together" segments. No I/O here.

/** A session counts as "playing now" if it was confirmed this recently. */
export const PRESENCE_FRESH_MS = 5 * 60_000;
/** Manual check-ins end by themselves after this long. */
export const MANUAL_MAX_MS = 6 * 60 * 60_000;

/** An open Steam-sourced session, with the Steam appid of its game. */
export type OpenSteamSession = { id: string; userId: string; appId: string | null };

/** What one poll saw for a user: the appid they're in, or null. */
export type SteamObservation = { userId: string; appId: string | null; gameName: string | null };

export type SteamPlan = {
  /** Still playing the same game: bump lastSeenAt. */
  keep: string[];
  /** Stopped (or switched game): close at lastSeenAt. */
  close: string[];
  /** Started a game: open a new session. */
  start: { userId: string; appId: string; gameName: string | null }[];
};

/**
 * Compares open sessions with what Steam reports now. Users with an open
 * session who are missing from the poll (e.g. unlinked Steam) are closed.
 */
export function planSteamUpdates(
  open: OpenSteamSession[],
  observed: SteamObservation[],
): SteamPlan {
  const plan: SteamPlan = { keep: [], close: [], start: [] };
  const openByUser = new Map<string, OpenSteamSession>();
  for (const s of open) {
    // At most one open Steam session per user; close any duplicates.
    if (openByUser.has(s.userId)) plan.close.push(s.id);
    else openByUser.set(s.userId, s);
  }
  const seen = new Set<string>();
  for (const o of observed) {
    if (seen.has(o.userId)) continue;
    seen.add(o.userId);
    const current = openByUser.get(o.userId);
    if (o.appId && current?.appId === o.appId) {
      plan.keep.push(current.id);
      continue;
    }
    if (current) plan.close.push(current.id);
    if (o.appId) plan.start.push({ userId: o.userId, appId: o.appId, gameName: o.gameName });
  }
  for (const [userId, s] of openByUser) if (!seen.has(userId)) plan.close.push(s.id);
  return plan;
}

/** A play interval in epoch ms. */
export type Interval = { userId: string; gameId: string; start: number; end: number };

export type TogetherSegment = {
  gameId: string;
  start: number;
  end: number;
  /** Everyone who was in the game while at least `minPlayers` were. */
  userIds: string[];
  /** Most players at the same time. */
  peak: number;
};

/** Merges one user's overlapping / touching intervals (e.g. Steam + a manual check-in). */
function mergeOwn(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

function byUserAndGame(sessions: Interval[]): Map<string, Interval[]> {
  const groups = new Map<string, Interval[]>();
  for (const s of sessions) {
    if (s.end <= s.start) continue;
    const key = `${s.gameId}\u0000${s.userId}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  for (const [k, v] of groups) groups.set(k, mergeOwn(v));
  return groups;
}

/**
 * Finds stretches where at least `minPlayers` people played the same game at
 * once. Stretches separated by short dips (someone restarting) are merged, and
 * very short ones dropped. Newest first.
 */
export function togetherSegments(
  sessions: Interval[],
  { minPlayers = 2, mergeGapMs = 5 * 60_000, minDurationMs = 5 * 60_000 } = {},
): TogetherSegment[] {
  const perGame = new Map<string, Interval[]>();
  for (const list of byUserAndGame(sessions).values()) {
    for (const i of list) perGame.set(i.gameId, [...(perGame.get(i.gameId) ?? []), i]);
  }

  const result: TogetherSegment[] = [];
  for (const [gameId, intervals] of perGame) {
    // Starts sort before ends at the same instant, so hand-overs count as overlap.
    const events = intervals
      .flatMap((i) => [
        { t: i.start, delta: 1, userId: i.userId },
        { t: i.end, delta: -1, userId: i.userId },
      ])
      .sort((a, b) => a.t - b.t || b.delta - a.delta);

    const active = new Set<string>();
    const raw: TogetherSegment[] = [];
    let current: TogetherSegment | null = null;
    for (const e of events) {
      if (e.delta > 0) active.add(e.userId);
      else active.delete(e.userId);
      if (!current && active.size >= minPlayers) {
        current = { gameId, start: e.t, end: e.t, userIds: [...active], peak: active.size };
      } else if (current && active.size >= minPlayers) {
        if (e.delta > 0 && !current.userIds.includes(e.userId)) current.userIds.push(e.userId);
        current.peak = Math.max(current.peak, active.size);
      } else if (current && active.size < minPlayers) {
        current.end = e.t;
        raw.push(current);
        current = null;
      }
    }

    const merged: TogetherSegment[] = [];
    for (const seg of raw) {
      const last = merged[merged.length - 1];
      if (last && seg.start - last.end <= mergeGapMs) {
        last.end = seg.end;
        last.peak = Math.max(last.peak, seg.peak);
        for (const u of seg.userIds) if (!last.userIds.includes(u)) last.userIds.push(u);
      } else merged.push({ ...seg, userIds: [...seg.userIds] });
    }
    result.push(...merged.filter((s) => s.end - s.start >= minDurationMs));
  }
  return result.sort((a, b) => b.start - a.start);
}

/** Total play time per user (own overlaps counted once), most first. */
export function playTotals(sessions: Interval[]): { userId: string; ms: number }[] {
  const totals = new Map<string, number>();
  for (const list of byUserAndGame(sessions).values()) {
    for (const i of list) totals.set(i.userId, (totals.get(i.userId) ?? 0) + (i.end - i.start));
  }
  return [...totals].map(([userId, ms]) => ({ userId, ms })).sort((a, b) => b.ms - a.ms);
}

/** Clips intervals to [from, to]. */
export function clip(sessions: Interval[], from: number, to: number): Interval[] {
  return sessions
    .map((s) => ({ ...s, start: Math.max(s.start, from), end: Math.min(s.end, to) }))
    .filter((s) => s.end > s.start);
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "不到 1 分钟";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} 分钟`;
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分钟`;
}
