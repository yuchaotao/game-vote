import { randomInt } from "node:crypto";
import { Prisma, type VoteGambleKind } from "@prisma/client";
import { postSystemMessage } from "@/lib/chat/service";
import { db } from "@/lib/db";
import { nextLuck, swapOptions, wins } from "./gamble-rules";
import { notifyChanged, openRound, VoteError } from "./service";
import { msg } from "@/lib/i18n";

// 赌一把 and 偷梁换柱 (#57): a few attempts each per member per anonymous round
// (the round's gambleLimit, #59), won with the member's lucky coin; losing is
// announced to the group.

async function nameOf(userId: string): Promise<string> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  return u?.displayName ?? "某人";
}

const USED_UP: Record<VoteGambleKind, string> = {
  PEEK: msg("这一轮的 {limit} 次赌一把已经用完了"),
  SWAP: msg("这一轮的 {limit} 次偷梁换柱已经用完了"),
};

async function begin(groupId: string, roundId: string) {
  const round = await openRound(groupId, roundId);
  if (!round.anonymous) throw new VoteError("只有匿名投票里才能这样做");
  return round;
}

/**
 * Inside a transaction: locks the round, checks this member has attempts left
 * and returns their luck (read under the lock, so quick double clicks can't
 * both use the last attempt or the same luck).
 */
async function claim(
  tx: Prisma.TransactionClient,
  round: { id: string; groupId: string; gambleLimit: number },
  userId: string,
  kind: VoteGambleKind,
) {
  await tx.$queryRaw`SELECT id FROM "VoteRound" WHERE id = ${round.id} FOR UPDATE`;
  const used = await tx.voteGamble.count({ where: { roundId: round.id, userId, kind } });
  if (used >= round.gambleLimit) {
    throw new VoteError(USED_UP[kind], { limit: round.gambleLimit });
  }
  const { luck } = await tx.groupMember.findUniqueOrThrow({
    where: { groupId_userId: { groupId: round.groupId, userId } },
    select: { luck: true },
  });
  return luck;
}

/**
 * 赌一把: win, and your next look at the round shows its results (once, and
 * nobody knows); lose, and the group sees that you tried.
 */
export async function gamblePeek(groupId: string, roundId: string, userId: string) {
  const round = await begin(groupId, roundId);
  const won = await db.$transaction(async (tx) => {
    const luck = await claim(tx, round, userId, "PEEK");
    const won = wins(luck, randomInt(100));
    await tx.voteGamble.create({
      data: { roundId, userId, kind: "PEEK", success: won, luckBefore: luck },
    });
    await tx.groupMember.update({
      where: { groupId_userId: { groupId, userId } },
      data: { luck: nextLuck(luck, won) },
    });
    return won;
  });
  if (!won) {
    await postSystemMessage(
      groupId,
      `🎲 ${await nameOf(userId)} 想偷看第 ${round.number} 轮投票的结果，赌输了！`,
      [userId],
    );
    await notifyChanged(groupId, roundId);
  }
  return won;
}

/** A won 赌一把 not used yet: true once, for the page that shows the results. */
export async function takePeek(roundId: string, userId: string): Promise<boolean> {
  const { count } = await db.voteGamble.updateMany({
    where: { roundId, userId, kind: "PEEK", success: true, seenAt: null },
    data: { seenAt: new Date() },
  });
  return count > 0;
}

/**
 * 偷梁换柱: picks one of another member's votes and one game you voted for. Win,
 * and that vote quietly becomes one for your game; lose, and the group sees
 * whose vote you tried to change.
 */
export async function gambleSwap(groupId: string, roundId: string, userId: string) {
  const round = await begin(groupId, roundId);
  const outcome = await db.$transaction(async (tx) => {
    // Same lock as voting, so ballots can't change underneath.
    const luck = await claim(tx, round, userId, "SWAP");
    const ballots = await tx.voteBallot.findMany({
      where: { roundId },
      select: { userId: true, gameId: true, count: true },
    });
    const options = swapOptions(userId, ballots, round.repeatVotes);
    if (options.length === 0) {
      throw new VoteError("现在没有可以换的票：你得先投票，别人也得投了其他游戏");
    }
    const pick = options[randomInt(options.length)];
    const won = wins(luck, randomInt(100));
    await tx.voteGamble.create({
      data: {
        roundId,
        userId,
        kind: "SWAP",
        success: won,
        luckBefore: luck,
        targetUserId: pick.victimId,
        fromGameId: pick.fromGameId,
        toGameId: pick.toGameId,
      },
    });
    await tx.groupMember.update({
      where: { groupId_userId: { groupId, userId } },
      data: { luck: nextLuck(luck, won) },
    });
    if (won) {
      const from = ballots.find((b) => b.userId === pick.victimId && b.gameId === pick.fromGameId)!;
      const where = {
        roundId_userId_gameId: { roundId, userId: pick.victimId, gameId: pick.fromGameId },
      };
      if (from.count === 1) await tx.voteBallot.delete({ where });
      else await tx.voteBallot.update({ where, data: { count: { decrement: 1 } } });
      await tx.voteBallot.upsert({
        where: {
          roundId_userId_gameId: { roundId, userId: pick.victimId, gameId: pick.toGameId },
        },
        create: { roundId, userId: pick.victimId, gameId: pick.toGameId },
        update: { count: { increment: 1 } },
      });
      // Shown in the replay after the reveal.
      await tx.voteEvent.create({
        data: {
          roundId,
          userId: pick.victimId,
          gameId: pick.fromGameId,
          toGameId: pick.toGameId,
          actorId: userId,
          kind: "SWAP",
        },
      });
    }
    return { won, pick };
  });
  if (!outcome.won) {
    await postSystemMessage(
      groupId,
      `😈 ${await nameOf(userId)} 尝试改 ${await nameOf(outcome.pick.victimId)} 的票，被抓了个正着！`,
      [userId],
    );
  }
  await notifyChanged(groupId, roundId);
  const game = await db.game.findUnique({
    where: { id: outcome.pick.toGameId },
    select: { name: true },
  });
  return { won: outcome.won, toGame: game?.name ?? "你的游戏" };
}

/** How many of each this member has used in the round. */
export async function myGambles(roundId: string, userId: string) {
  const rows = await db.voteGamble.groupBy({
    by: ["kind"],
    where: { roundId, userId },
    _count: true,
  });
  const used = (kind: VoteGambleKind) => rows.find((r) => r.kind === kind)?._count ?? 0;
  return { peek: used("PEEK"), swap: used("SWAP") };
}

/** Failed attempts, which everyone may see. */
export async function exposures(roundId: string) {
  const rows = await db.voteGamble.findMany({
    where: { roundId, success: false },
    orderBy: { at: "asc" },
    select: {
      kind: true,
      user: { select: { displayName: true } },
      target: { select: { displayName: true } },
    },
  });
  return rows.map((r) =>
    r.kind === "PEEK"
      ? `🎲 ${r.user.displayName} 偷看失败`
      : `😈 ${r.user.displayName} 尝试改 ${r.target?.displayName ?? "某人"} 的票`,
  );
}
