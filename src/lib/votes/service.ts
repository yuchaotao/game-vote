import { Prisma, VoteEndReason, VoteEventKind, VoteRoundStatus } from "@prisma/client";
import IORedis from "ioredis";
import { postSystemMessage } from "@/lib/chat/service";
import { db } from "@/lib/db";
import { notifyGroup } from "@/lib/notify/service";
import { env } from "@/lib/env";
import { publicUser } from "@/lib/friends/service";
import { getLibraryEntry } from "@/lib/games/service";
import { libraryHotness } from "@/lib/play/service";
import { redis } from "@/lib/redis";
import { scheduleDiscordSync } from "./discord-sync";
import {
  canAdd,
  deadlineError,
  endReasonText,
  formatReveal,
  nextReveal,
  standings,
  winnerOf,
  type RoundSettings,
  type Standing,
} from "./rules";

export class VoteError extends Error {}

const votesChannel = (groupId: string) => `group:${groupId}:votes`;

/** Tells open pages of this group that a round changed. */
export async function notifyChanged(groupId: string, roundId: string) {
  await redis().publish(votesChannel(groupId), JSON.stringify({ roundId }));
  await scheduleDiscordSync(roundId);
}

/** Live "a round changed" signals for a group (own connection per subscriber). */
export async function subscribeVotes(
  groupId: string,
  onChange: (data: { roundId: string }) => void,
): Promise<() => Promise<void>> {
  const sub = new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null });
  sub.on("message", (_channel, payload: string) => onChange(JSON.parse(payload)));
  await sub.subscribe(votesChannel(groupId));
  return async () => {
    await sub.quit().catch(() => sub.disconnect());
  };
}

async function nameOf(userId: string): Promise<string> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  return u?.displayName ?? "某人";
}

const roundLabel = (r: { number: number; title: string }) =>
  r.title ? `第 ${r.number} 轮《${r.title}》` : `第 ${r.number} 轮投票`;

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** Starts a round. `carryFrom` copies that round's candidates (votes reset). */
export async function startRound(
  groupId: string,
  userId: string,
  settings: RoundSettings,
  carryFrom?: string,
) {
  const tooLate = deadlineError(settings.deadline);
  if (tooLate) throw new VoteError(tooLate);
  const carried = carryFrom
    ? await db.voteCandidate.findMany({
        where: { roundId: carryFrom },
        orderBy: { addedAt: "asc" },
      })
    : [];

  let round;
  try {
    round = await db.$transaction(async (tx) => {
      const last = await tx.voteRound.findFirst({
        where: { groupId },
        orderBy: { number: "desc" },
        select: { number: true },
      });
      const created = await tx.voteRound.create({
        data: {
          groupId,
          number: (last?.number ?? 0) + 1,
          title: settings.title,
          maxVotes: settings.maxVotes,
          deadline: settings.deadline,
          anonymous: settings.anonymous,
          repeatVotes: settings.repeatVotes,
          startedById: userId,
          previousId: carryFrom ?? null,
        },
      });
      for (const c of carried) {
        await tx.voteCandidate.create({
          data: { roundId: created.id, gameId: c.gameId, addedById: c.addedById },
        });
        await tx.voteEvent.create({
          data: { roundId: created.id, gameId: c.gameId, userId: c.addedById, kind: "CANDIDATE" },
        });
      }
      return created;
    });
  } catch (err) {
    // The partial unique index allows one OPEN round per group.
    if (isUniqueViolation(err)) throw new VoteError("已经有一个进行中的投票了");
    throw err;
  }

  const anonymity =
    (round.repeatVotes ? "，可以重复投同一个游戏" : "") +
    (round.anonymous && round.deadline ? `，匿名投票，${formatReveal(round.deadline)} 揭榜` : "");
  await postSystemMessage(
    groupId,
    `${await nameOf(userId)} 发起了${roundLabel(round)}，每人最多 ${round.maxVotes} 票${anonymity}`,
    [userId],
  );
  await notifyChanged(groupId, round.id);
  const starter = await nameOf(userId);
  await notifyMembers(groupId, userId, "NEW_ROUND", (group) => ({
    title: `「${group}」发起了${roundLabel(round)}`,
    body: `${starter} 在「${group}」发起了${roundLabel(round)}，每人最多 ${round.maxVotes} 票${anonymity}，快来投票吧。`,
    path: `/groups/${groupId}/votes/${round.id}`,
    refId: round.id,
  }));
  return round;
}

/** Notifies every member of the group except `exceptUserId` (by email, DM or the group's channel). */
export async function notifyMembers(
  groupId: string,
  exceptUserId: string | null,
  event: "NEW_ROUND" | "VOTE_PROMPT",
  content: (groupName: string) => { title: string; body: string; path: string; refId?: string },
) {
  await notifyGroup(event, groupId, exceptUserId, content);
}

export async function openRound(groupId: string, roundId: string) {
  const round = await db.voteRound.findFirst({ where: { id: roundId, groupId } });
  if (!round) throw new VoteError("投票不存在");
  if (round.status !== VoteRoundStatus.OPEN) throw new VoteError("这轮投票已经结束了");
  if (round.deadline && round.deadline <= new Date()) {
    await endRound(groupId, roundId, null, VoteEndReason.DEADLINE);
    throw new VoteError("这轮投票已到截止时间");
  }
  return round;
}

/** Hot scores of the candidates, for breaking ties. */
async function hotScores(groupId: string, gameIds: string[]): Promise<Record<string, number>> {
  const entries = await db.groupGame.findMany({
    where: { groupId, gameId: { in: gameIds } },
    select: { gameId: true, addedAt: true },
  });
  const hot = await libraryHotness(groupId, entries);
  return Object.fromEntries(Object.entries(hot).map(([id, h]) => [id, h.score]));
}

export async function roundStandings(groupId: string, roundId: string): Promise<Standing[]> {
  const [candidates, ballots] = await Promise.all([
    db.voteCandidate.findMany({ where: { roundId }, orderBy: { addedAt: "asc" } }),
    db.voteBallot.findMany({ where: { roundId }, orderBy: { castAt: "asc" } }),
  ]);
  const hot = await hotScores(
    groupId,
    candidates.map((c) => c.gameId),
  );
  return standings(candidates, ballots, hot);
}

/**
 * Ends an open round and records the winner. Idempotent: a round that's
 * already ended is returned unchanged (two members clicking at once).
 */
export async function endRound(
  groupId: string,
  roundId: string,
  userId: string | null,
  reason: VoteEndReason,
) {
  const final = await roundStandings(groupId, roundId);
  const winnerGameId = winnerOf(final);
  const { count } = await db.voteRound.updateMany({
    where: { id: roundId, groupId, status: VoteRoundStatus.OPEN },
    data: {
      status: VoteRoundStatus.ENDED,
      endedAt: new Date(),
      endedById: userId,
      endReason: reason,
      winnerGameId,
    },
  });
  const round = await db.voteRound.findUniqueOrThrow({
    where: { id: roundId },
    include: { winner: { select: { name: true } } },
  });
  if (count === 0) return round;
  // Ended some other way: an unanswered prompt no longer applies.
  await db.votePrompt.updateMany({
    where: { roundId, status: "PENDING" },
    data: { status: "EXPIRED", resolvedAt: new Date() },
  });

  const who = userId ? `${await nameOf(userId)} ` : "";
  const result = round.winner ? `胜出：《${round.winner.name}》` : "没有人投票";
  await postSystemMessage(
    groupId,
    `${roundLabel(round)}已结束（${who}${endReasonText(reason, round.anonymous)}）。${result}`,
    userId ? [userId] : [],
  );
  await notifyChanged(groupId, roundId);
  return round;
}

/** "结束并开启下一轮": ends the round and starts the next with the same candidates. */
export async function endAndStartNext(
  groupId: string,
  roundId: string,
  userId: string,
  reason: VoteEndReason = VoteEndReason.NEXT_ROUND,
) {
  const ended = await endRound(groupId, roundId, userId, reason);
  const next = await startRound(
    groupId,
    userId,
    // An anonymous round is followed by another, revealed next Friday.
    {
      title: "",
      maxVotes: ended.maxVotes,
      deadline: ended.anonymous ? nextReveal() : null,
      anonymous: ended.anonymous,
      repeatVotes: ended.repeatVotes,
    },
    roundId,
  );
  return { ended, next };
}

/** Closes rounds whose deadline has passed (worker job). */
export async function closeDueRounds(now = new Date()) {
  const due = await db.voteRound.findMany({
    where: { status: VoteRoundStatus.OPEN, deadline: { lte: now } },
    select: { id: true, groupId: true },
  });
  for (const r of due) await endRound(r.groupId, r.id, null, VoteEndReason.DEADLINE);
  return { closed: due.length };
}

/** Adds a library game as a candidate of an open round. */
export async function addCandidate(
  groupId: string,
  roundId: string,
  userId: string,
  gameId: string,
) {
  await openRound(groupId, roundId);
  const entry = await getLibraryEntry(groupId, gameId);
  if (!entry) throw new VoteError("请先把游戏加入游戏库");
  try {
    await db.$transaction([
      db.voteCandidate.create({ data: { roundId, gameId, addedById: userId } }),
      db.voteEvent.create({ data: { roundId, gameId, userId, kind: VoteEventKind.CANDIDATE } }),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) throw new VoteError(`《${entry.game.name}》已经是候选了`);
    throw err;
  }
  await notifyChanged(groupId, roundId);
  return entry.game;
}

/** Removes a candidate nobody has voted for; only whoever added it or the group owner. */
export async function removeCandidate(
  groupId: string,
  roundId: string,
  userId: string,
  gameId: string,
) {
  await openRound(groupId, roundId);
  const [candidate, group, votes] = await Promise.all([
    db.voteCandidate.findUnique({ where: { roundId_gameId: { roundId, gameId } } }),
    db.group.findUniqueOrThrow({ where: { id: groupId }, select: { ownerId: true } }),
    db.voteBallot.count({ where: { roundId, gameId } }),
  ]);
  if (!candidate) throw new VoteError("候选不存在");
  if (candidate.addedById !== userId && group.ownerId !== userId) {
    throw new VoteError("只有添加者或群主可以移除候选");
  }
  if (votes > 0) throw new VoteError("已经有人投票的候选不能移除");
  await db.$transaction([
    db.voteCandidate.delete({ where: { roundId_gameId: { roundId, gameId } } }),
    db.voteEvent.create({ data: { roundId, gameId, userId, kind: VoteEventKind.REMOVED } }),
  ]);
  await notifyChanged(groupId, roundId);
}

/**
 * Casts or retracts the user's vote for a candidate. Serialised per round
 * (row lock) so the per-person limit holds under concurrent clicks.
 */
/** Locks the round for this member's vote; returns it with their votes per game. */
async function lockForVote(tx: Prisma.TransactionClient, roundId: string, userId: string) {
  await tx.$queryRaw`SELECT id FROM "VoteRound" WHERE id = ${roundId} FOR UPDATE`;
  const round = await tx.voteRound.findUniqueOrThrow({ where: { id: roundId } });
  if (round.status !== VoteRoundStatus.OPEN) throw new VoteError("这轮投票已经结束了");
  const mine = await tx.voteBallot.findMany({
    where: { roundId, userId },
    select: { gameId: true, count: true },
  });
  const onGame = (gameId: string) => mine.find((b) => b.gameId === gameId)?.count ?? 0;
  return { round, onGame, used: mine.reduce((n, b) => n + b.count, 0) };
}

/** One more vote for the game; returns this member's votes on it. */
async function addOne(
  tx: Prisma.TransactionClient,
  roundId: string,
  userId: string,
  gameId: string,
) {
  const { round, onGame, used } = await lockForVote(tx, roundId, userId);
  const isCandidate = (await tx.voteCandidate.count({ where: { roundId, gameId } })) > 0;
  const check = canAdd({
    used,
    maxVotes: round.maxVotes,
    isCandidate,
    onThisGame: onGame(gameId),
    repeat: round.repeatVotes,
  });
  if (!check.ok) throw new VoteError(check.error);
  await tx.voteBallot.upsert({
    where: { roundId_userId_gameId: { roundId, userId, gameId } },
    create: { roundId, userId, gameId },
    update: { count: { increment: 1 } },
  });
  await tx.voteEvent.create({ data: { roundId, userId, gameId, kind: VoteEventKind.CAST } });
  return onGame(gameId) + 1;
}

/** Takes one vote back from the game; returns this member's votes left on it. */
async function removeOne(
  tx: Prisma.TransactionClient,
  roundId: string,
  userId: string,
  gameId: string,
) {
  const { onGame } = await lockForVote(tx, roundId, userId);
  const n = onGame(gameId);
  if (n === 0) throw new VoteError("你还没有给这个游戏投票");
  const where = { roundId_userId_gameId: { roundId, userId, gameId } };
  if (n === 1) await tx.voteBallot.delete({ where });
  else await tx.voteBallot.update({ where, data: { count: { decrement: 1 } } });
  await tx.voteEvent.create({ data: { roundId, userId, gameId, kind: VoteEventKind.RETRACT } });
  return n - 1;
}

/** Votes for the game, or takes your vote back (one-vote-per-game rounds). */
export async function toggleVote(groupId: string, roundId: string, userId: string, gameId: string) {
  await openRound(groupId, roundId);
  const cast = await db.$transaction(async (tx) => {
    const { onGame } = await lockForVote(tx, roundId, userId);
    if (onGame(gameId) > 0) {
      await removeOne(tx, roundId, userId, gameId);
      return false;
    }
    await addOne(tx, roundId, userId, gameId);
    return true;
  });
  await notifyChanged(groupId, roundId);
  return cast;
}

/** One more vote for the game (#53); returns your votes on it. */
export async function addVote(groupId: string, roundId: string, userId: string, gameId: string) {
  await openRound(groupId, roundId);
  const n = await db.$transaction((tx) => addOne(tx, roundId, userId, gameId));
  await notifyChanged(groupId, roundId);
  return n;
}

/** Takes one of your votes back from the game; returns your votes left on it. */
export async function removeVote(groupId: string, roundId: string, userId: string, gameId: string) {
  await openRound(groupId, roundId);
  const n = await db.$transaction((tx) => removeOne(tx, roundId, userId, gameId));
  await notifyChanged(groupId, roundId);
  return n;
}

/** A member's votes in a round: on one game, and in total. */
export async function myVotes(roundId: string, userId: string, gameId: string) {
  const ballots = await db.voteBallot.findMany({
    where: { roundId, userId },
    select: { gameId: true, count: true },
  });
  return {
    onGame: ballots.find((b) => b.gameId === gameId)?.count ?? 0,
    used: ballots.reduce((n, b) => n + b.count, 0),
  };
}

const roundInclude = {
  startedBy: { select: publicUser },
  endedBy: { select: publicUser },
  winner: { select: { id: true, name: true, coverUrl: true } },
  candidates: {
    orderBy: { addedAt: "asc" },
    include: { game: true, addedBy: { select: publicUser } },
  },
  ballots: { include: { user: { select: publicUser } } },
} satisfies Prisma.VoteRoundInclude;

export type RoundDetail = Prisma.VoteRoundGetPayload<{ include: typeof roundInclude }>;

/** A round with candidates, ballots and standings; closes it first if its deadline passed. */
export async function getRound(groupId: string, roundId: string) {
  let round = await db.voteRound.findFirst({
    where: { id: roundId, groupId },
    include: roundInclude,
  });
  if (!round) return null;
  if (round.status === VoteRoundStatus.OPEN && round.deadline && round.deadline <= new Date()) {
    await endRound(groupId, roundId, null, VoteEndReason.DEADLINE);
    round = await db.voteRound.findFirstOrThrow({ where: { id: roundId }, include: roundInclude });
  }
  const list = standings(
    round.candidates,
    round.ballots,
    await hotScores(
      groupId,
      round.candidates.map((c) => c.gameId),
    ),
  );
  return { round, standings: list };
}

export function currentRound(groupId: string) {
  return db.voteRound.findFirst({
    where: { groupId, status: VoteRoundStatus.OPEN },
    select: { id: true },
  });
}

/** All rounds of a group, newest first. */
export function listRounds(groupId: string) {
  return db.voteRound.findMany({
    where: { groupId },
    orderBy: { number: "desc" },
    include: {
      startedBy: { select: publicUser },
      winner: { select: { id: true, name: true, coverUrl: true } },
      _count: { select: { candidates: true } },
      ballots: { select: { userId: true } },
    },
  });
}

/** Everything that happened in a round, for replay. */
export function roundEvents(roundId: string) {
  return db.voteEvent.findMany({
    where: { roundId },
    orderBy: { at: "asc" },
    select: { kind: true, userId: true, gameId: true, at: true, game: { select: { name: true } } },
  });
}

/** Votes cast in a group recently, feeding the hot score. */
export function recentVotes(groupId: string, since: Date) {
  return db.voteBallot.findMany({
    where: { round: { groupId }, castAt: { gte: since } },
    select: { gameId: true, castAt: true },
  });
}

/** Who peeked at an anonymous round (before 赌一把 replaced peeking), first first. */
export function peekers(roundId: string) {
  return db.votePeek.findMany({
    where: { roundId },
    orderBy: { at: "asc" },
    select: { userId: true, user: { select: { displayName: true } } },
  });
}

/** True only the first time this member opens a revealed anonymous round. */
export async function firstRevealVisit(roundId: string, userId: string): Promise<boolean> {
  const { count } = await db.voteRevealSeen.createMany({
    data: [{ roundId, userId }],
    skipDuplicates: true,
  });
  return count > 0;
}
