import { PlaySource } from "@prisma/client";
import { postSystemMessage } from "@/lib/chat/service";
import { refreshSteamProfile } from "@/lib/auth/users";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { publicUser, type PublicUser } from "@/lib/friends/service";
import { getLibraryEntry, steamGameFromPresence } from "@/lib/games/service";
import { hotness, HOTNESS, type Hotness } from "@/lib/games/hotness";
import { redis } from "@/lib/redis";
import {
  clip,
  MANUAL_MAX_MS,
  planSteamUpdates,
  playTotals,
  PRESENCE_FRESH_MS,
  togetherSegments,
  type Interval,
} from "./rules";
import { getSteamPresence } from "./steam-presence";
import { LocalizedError } from "@/lib/i18n";

export class PlayError extends LocalizedError {}

const DAY_MS = 24 * 60 * 60_000;
/** Steam online state / profile visibility, kept a little longer than one poll interval. */
const STEAM_STATE_TTL_SECONDS = 6 * 60;
const steamStateKey = (userId: string) => `presence:steam:${userId}`;

type SteamState = { online: boolean; publicProfile: boolean };

/**
 * One Steam poll: records who started / kept / stopped playing what, and caches
 * online state. Does nothing without an API key; changes nothing if Steam fails.
 */
export async function pollSteam(now = new Date()) {
  const { STEAM_API_KEY, STEAM_API_URL } = env();
  if (!STEAM_API_KEY) return { polled: 0, skipped: "no-key" as const };

  const accounts = await db.account.findMany({
    where: { provider: "steam" },
    select: { userId: true, providerAccountId: true },
  });
  const players = await getSteamPresence(
    accounts.map((a) => a.providerAccountId),
    { apiKey: STEAM_API_KEY, baseUrl: STEAM_API_URL.replace(/\/+$/, "") },
  );
  if (!players) return { polled: 0, skipped: "steam-unavailable" as const };

  const userBySteamId = new Map(accounts.map((a) => [a.providerAccountId, a.userId]));
  const observed = players.flatMap((p) => {
    const userId = userBySteamId.get(p.steamId);
    return userId ? [{ userId, appId: p.appId, gameName: p.gameName, p }] : [];
  });

  const pipeline = redis().pipeline();
  for (const o of observed) {
    const state: SteamState = { online: o.p.personaState > 0, publicProfile: o.p.visibility === 3 };
    pipeline.set(steamStateKey(o.userId), JSON.stringify(state), "EX", STEAM_STATE_TTL_SECONDS);
  }
  await pipeline.exec();

  // Keep names / avatars current (also repairs placeholders from when Steam was unreachable).
  for (const p of players) await refreshSteamProfile(p.steamId, p);

  const open = await db.playSession.findMany({
    where: { source: PlaySource.STEAM, endedAt: null },
    select: { id: true, userId: true, game: { select: { externalId: true } } },
  });
  const plan = planSteamUpdates(
    open.map((s) => ({ id: s.id, userId: s.userId, appId: s.game.externalId })),
    observed,
  );

  // Resolve games before writing, so one slow store lookup doesn't hold a transaction.
  const starts = [];
  for (const s of plan.start) {
    const game = await steamGameFromPresence(s.appId, s.gameName);
    if (game) starts.push({ userId: s.userId, gameId: game.id });
  }

  await db.$transaction([
    db.playSession.updateMany({ where: { id: { in: plan.keep } }, data: { lastSeenAt: now } }),
    // A stopped session ends when it was last confirmed, not at this poll.
    db.$executeRaw`UPDATE "PlaySession" SET "endedAt" = "lastSeenAt" WHERE id = ANY(${plan.close}::text[])`,
    db.playSession.createMany({
      data: starts.map((s) => ({
        ...s,
        source: PlaySource.STEAM,
        startedAt: now,
        lastSeenAt: now,
      })),
    }),
  ]);
  return {
    polled: observed.length,
    kept: plan.keep.length,
    closed: plan.close.length,
    started: starts.length,
  };
}

/** Keeps manual check-ins alive, ending those older than MANUAL_MAX_MS. */
export async function tickManualSessions(now = new Date()) {
  const cutoff = new Date(now.getTime() - MANUAL_MAX_MS);
  const [, expired] = await db.$transaction([
    db.playSession.updateMany({
      where: { source: PlaySource.MANUAL, endedAt: null, startedAt: { gte: cutoff } },
      data: { lastSeenAt: now },
    }),
    db.$executeRaw`UPDATE "PlaySession"
      SET "endedAt" = "startedAt" + ${MANUAL_MAX_MS} * interval '1 millisecond',
          "lastSeenAt" = "startedAt" + ${MANUAL_MAX_MS} * interval '1 millisecond'
      WHERE source = 'MANUAL' AND "endedAt" IS NULL AND "startedAt" < ${cutoff}`,
  ]);
  return { expired };
}

/** "开黑签到": the user says they're playing a game from this group's library. */
export async function checkIn(groupId: string, userId: string, gameId: string) {
  const entry = await getLibraryEntry(groupId, gameId);
  if (!entry) throw new PlayError("请选择游戏库里的游戏");
  const now = new Date();
  await db.$transaction([
    db.playSession.updateMany({
      where: { userId, source: PlaySource.MANUAL, endedAt: null },
      data: { endedAt: now, lastSeenAt: now },
    }),
    db.playSession.create({
      data: { userId, gameId, source: PlaySource.MANUAL, startedAt: now, lastSeenAt: now },
    }),
  ]);
  const user = await db.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  await postSystemMessage(
    groupId,
    `${user?.displayName ?? "某人"} 签到：正在玩《${entry.game.name}》`,
    [userId],
  );
  return entry.game;
}

export async function checkOut(userId: string) {
  const now = new Date();
  const { count } = await db.playSession.updateMany({
    where: { userId, source: PlaySource.MANUAL, endedAt: null },
    data: { endedAt: now, lastSeenAt: now },
  });
  return count;
}

export type Presence = {
  playing: {
    gameId: string;
    name: string;
    since: Date;
    source: PlaySource;
  } | null;
  /** Online on Steam (only known for users with Steam linked). */
  steamOnline: boolean;
  /** Steam profile is private, so games can't be seen. Null when unknown / not linked. */
  steamPrivate: boolean | null;
};

/** Current status for a set of users. */
export async function presenceFor(userIds: string[]): Promise<Record<string, Presence>> {
  if (userIds.length === 0) return {};
  const fresh = new Date(Date.now() - PRESENCE_FRESH_MS);
  const [sessions, states] = await Promise.all([
    db.playSession.findMany({
      where: { userId: { in: userIds }, endedAt: null, lastSeenAt: { gte: fresh } },
      include: { game: { select: { name: true } } },
      orderBy: { startedAt: "asc" },
    }),
    redis().mget(userIds.map(steamStateKey)),
  ]);
  const result: Record<string, Presence> = {};
  userIds.forEach((id, i) => {
    const state = states[i] ? (JSON.parse(states[i]!) as SteamState) : null;
    result[id] = {
      playing: null,
      steamOnline: state?.online ?? false,
      steamPrivate: state ? !state.publicProfile : null,
    };
  });
  for (const s of sessions) {
    // Steam beats a manual check-in for the same user (it's automatic and current).
    const current = result[s.userId].playing;
    if (current && current.source === PlaySource.STEAM) continue;
    result[s.userId].playing = {
      gameId: s.gameId,
      name: s.game.name,
      since: s.startedAt,
      source: s.source,
    };
  }
  return result;
}

/** The user's own open manual check-in, if any. */
export function openCheckIn(userId: string) {
  return db.playSession.findFirst({
    where: { userId, source: PlaySource.MANUAL, endedAt: null },
    include: { game: { select: { id: true, name: true } } },
  });
}

async function memberIntervals(
  groupId: string,
  since: Date,
  gameId?: string,
): Promise<{
  intervals: Interval[];
  members: Map<string, PublicUser>;
  /** `gameId|userId` of sessions still open and recently confirmed. */
  liveKeys: Set<string>;
}> {
  const members = await db.groupMember.findMany({
    where: { groupId },
    select: { user: { select: publicUser } },
  });
  const sessions = await db.playSession.findMany({
    where: {
      userId: { in: members.map((m) => m.user.id) },
      gameId,
      OR: [{ endedAt: null }, { endedAt: { gt: since } }],
    },
    select: { userId: true, gameId: true, startedAt: true, endedAt: true, lastSeenAt: true },
  });
  const intervals = sessions.map((s) => ({
    userId: s.userId,
    gameId: s.gameId,
    start: s.startedAt.getTime(),
    end: (s.endedAt ?? s.lastSeenAt).getTime(),
  }));
  const freshAfter = Date.now() - PRESENCE_FRESH_MS;
  const liveKeys = new Set(
    sessions
      .filter((s) => !s.endedAt && s.lastSeenAt.getTime() >= freshAfter)
      .map((s) => `${s.gameId}|${s.userId}`),
  );
  return {
    liveKeys,
    intervals: clip(intervals, since.getTime(), Date.now()),
    members: new Map(members.map((m) => [m.user.id, m.user])),
  };
}

export type TogetherDTO = {
  game: { id: string; name: string; coverUrl: string | null };
  start: Date;
  end: Date;
  members: PublicUser[];
  peak: number;
  /** Still going: at least two of its players are in the game right now. */
  live: boolean;
};

/** Times group members played the same game together, newest first. */
export async function groupTogether(
  groupId: string,
  { days = 30, gameId, limit = 20 }: { days?: number; gameId?: string; limit?: number } = {},
): Promise<TogetherDTO[]> {
  const since = new Date(Date.now() - days * DAY_MS);
  const { intervals, members, liveKeys } = await memberIntervals(groupId, since, gameId);
  const segments = togetherSegments(intervals).slice(0, limit);
  const games = await db.game.findMany({
    where: { id: { in: [...new Set(segments.map((s) => s.gameId))] } },
    select: { id: true, name: true, coverUrl: true },
  });
  const gameById = new Map(games.map((g) => [g.id, g]));
  return segments.map((s) => ({
    game: gameById.get(s.gameId)!,
    start: new Date(s.start),
    end: new Date(s.end),
    members: s.userIds.flatMap((id) => members.get(id) ?? []),
    peak: s.peak,
    live: s.userIds.filter((u) => liveKeys.has(`${s.gameId}|${u}`)).length >= 2,
  }));
}

/** Per-member play time for one game over the last `days`. */
export async function gamePlayTotals(groupId: string, gameId: string, days = 30) {
  const since = new Date(Date.now() - days * DAY_MS);
  const { intervals, members } = await memberIntervals(groupId, since, gameId);
  return playTotals(intervals).flatMap(({ userId, ms }) => {
    const user = members.get(userId);
    return user ? [{ user, ms }] : [];
  });
}

/** For settings: the most recent game Steam reported for this user. */
export function lastSteamSession(userId: string) {
  return db.playSession.findFirst({
    where: { userId, source: PlaySource.STEAM },
    orderBy: { lastSeenAt: "desc" },
    include: { game: { select: { name: true } } },
  });
}

/** Hot scores for a group's library from members' recent play and votes. */
export async function libraryHotness(
  groupId: string,
  entries: { gameId: string; addedAt: Date }[],
): Promise<Record<string, Hotness>> {
  const since = new Date(Date.now() - HOTNESS.windowMs);
  const [{ intervals }, votes] = await Promise.all([
    memberIntervals(groupId, since),
    db.voteBallot.findMany({
      // Votes in an anonymous round stay out until it is revealed.
      where: {
        round: { groupId, OR: [{ anonymous: false }, { status: "ENDED" }] },
        castAt: { gte: since },
      },
      select: { gameId: true, castAt: true, count: true },
    }),
  ]);
  // A ballot with several votes counts as that many.
  const each = votes.flatMap((v) => Array.from({ length: v.count }, () => v));
  return hotness(entries, intervals, each);
}

/** Group members' play since `since` (open sessions end at their last confirmation). */
export async function groupPlayIntervals(groupId: string, since: Date): Promise<Interval[]> {
  return (await memberIntervals(groupId, since)).intervals;
}
