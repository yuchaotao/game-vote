import { Prisma, VoteEndReason, VotePromptStatus, VoteRoundStatus } from "@prisma/client";
import { postSystemMessage } from "@/lib/chat/service";
import { db } from "@/lib/db";
import { groupPlayIntervals } from "@/lib/play/service";
import { formatDuration } from "@/lib/play/rules";
import { PROMPT_RULE, promptCandidates } from "./prompt-rules";
import {
  endAndStartNext,
  endRound,
  notifyChanged,
  notifyMembers,
  roundStandings,
  VoteError,
} from "./service";

// "You're already playing a front-runner together: end the vote?" (#10)

/** Where the game stands, unless the round is anonymous (then that stays secret). */
const placeOf = (round: { number: number; anonymous: boolean }, rank: number) =>
  round.anonymous
    ? `它是第 ${round.number} 轮投票的候选。`
    : `它在第 ${round.number} 轮投票中排第 ${rank}。`;

/** Looks at every open round and raises at most one prompt per round (worker job). */
export async function checkPrompts(now = new Date()) {
  const rounds = await db.voteRound.findMany({
    where: { status: VoteRoundStatus.OPEN },
    select: { id: true, groupId: true, number: true, title: true, anonymous: true },
  });
  let raised = 0;
  for (const round of rounds) {
    const [memberCount, intervals, standings, prompts] = await Promise.all([
      db.groupMember.count({ where: { groupId: round.groupId } }),
      // Long enough to see a whole evening's session.
      groupPlayIntervals(round.groupId, new Date(now.getTime() - 12 * 60 * 60_000)),
      roundStandings(round.groupId, round.id),
      db.votePrompt.findMany({
        where: { roundId: round.id },
        select: { gameId: true, playingSince: true, status: true },
      }),
    ]);
    const [candidate] = promptCandidates({
      memberCount,
      intervals,
      standings,
      prompts,
      now: now.getTime(),
    });
    if (!candidate) continue;

    let prompt;
    try {
      prompt = await db.votePrompt.create({
        data: {
          roundId: round.id,
          gameId: candidate.gameId,
          players: candidate.players,
          memberCount,
          rank: candidate.rank,
          playingSince: candidate.playingSince,
        },
        include: { game: { select: { name: true } } },
      });
    } catch (e) {
      // Another check already raised one for this round (one pending per round).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
    raised++;
    const minutes = formatDuration(now.getTime() - candidate.playingSince.getTime());
    await postSystemMessage(
      round.groupId,
      `检测到 ${candidate.players}/${memberCount} 名成员正在一起玩《${prompt.game.name}》（已 ${minutes}），` +
        `${placeOf(round, candidate.rank)}可以在群页面顶部选择是否结束投票。`,
    );
    await notifyChanged(round.groupId, round.id);
    await notifyMembers(round.groupId, null, "VOTE_PROMPT", (group) => ({
      title: `「${group}」：大家正在一起玩《${prompt.game.name}》`,
      body:
        `检测到 ${candidate.players}/${memberCount} 名成员正在一起玩《${prompt.game.name}》（已 ${minutes}），` +
        `${placeOf(round, candidate.rank)}要结束这轮投票吗？`,
      path: `/groups/${round.groupId}`,
      refId: prompt.id,
    }));
  }
  return { checked: rounds.length, raised };
}

export type PromptChoice = "continue" | "next" | "end";

const CHOICE_STATUS: Record<PromptChoice, VotePromptStatus> = {
  continue: VotePromptStatus.CONTINUED,
  next: VotePromptStatus.ENDED_NEXT,
  end: VotePromptStatus.ENDED,
};

/**
 * Any member answers a pending prompt. The first answer wins; a second member
 * clicking at the same time gets "already handled". Returns the new round id
 * for "next".
 */
export async function resolvePrompt(
  groupId: string,
  promptId: string,
  userId: string,
  choice: PromptChoice,
): Promise<string | null> {
  const prompt = await db.votePrompt.findFirst({
    where: { id: promptId, round: { groupId } },
    include: { game: { select: { name: true } }, round: true },
  });
  if (!prompt) throw new VoteError("提示不存在");
  const { count } = await db.votePrompt.updateMany({
    where: { id: promptId, status: VotePromptStatus.PENDING },
    data: { status: CHOICE_STATUS[choice], resolvedAt: new Date(), resolvedById: userId },
  });
  if (count === 0) throw new VoteError("这个提示已经有人处理了");

  if (choice === "continue") {
    const who = await db.user.findUnique({ where: { id: userId }, select: { displayName: true } });
    await postSystemMessage(
      groupId,
      `${who?.displayName ?? "某人"} 选择继续当前投票（《${prompt.game.name}》的提示已忽略）`,
      [userId],
    );
    await notifyChanged(groupId, prompt.roundId);
    return null;
  }
  if (choice === "next") {
    const { next } = await endAndStartNext(groupId, prompt.roundId, userId, VoteEndReason.PROMPT);
    return next.id;
  }
  await endRound(groupId, prompt.roundId, userId, VoteEndReason.PROMPT);
  return null;
}

/** The group's unanswered prompt, if any (shown as a banner on every group page). */
export function pendingPrompt(groupId: string) {
  return db.votePrompt.findFirst({
    where: { status: VotePromptStatus.PENDING, round: { groupId, status: VoteRoundStatus.OPEN } },
    include: {
      game: { select: { id: true, name: true, coverUrl: true } },
      round: { select: { id: true, number: true, title: true, anonymous: true } },
    },
  });
}

export const PROMPT_MINUTES = PROMPT_RULE.minTogetherMs / 60_000;
