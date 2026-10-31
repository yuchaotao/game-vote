import { VotePromptStatus, VoteRoundStatus, type Notification } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isActiveMember } from "@/lib/groups/service";
import { editMessage } from "@/lib/notify/discord-bot";
import { absoluteUrl } from "@/lib/urls";
import {
  ephemeral,
  parseButtonId,
  renderPrompt,
  renderRound,
  type PromptView,
  type RoundView,
  voteStepper,
} from "./discord-render";
import { resolvePrompt, type PromptChoice } from "./prompts";
import { resultsHidden } from "./rules";
import { addVote, getRound, myVotes, peekers, removeVote, toggleVote, VoteError } from "./service";

// Voting from Discord (#47): the live round message, prompt messages, and the
// buttons on them. Rules are the website's: these call the same services.

const roundLabel = (r: { number: number; title: string }) =>
  r.title ? `第 ${r.number} 轮《${r.title}》` : `第 ${r.number} 轮投票`;

async function roundView(roundId: string): Promise<RoundView | null> {
  const head = await db.voteRound.findUnique({
    where: { id: roundId },
    select: { groupId: true, group: { select: { name: true } } },
  });
  if (!head) return null;
  const detail = await getRound(head.groupId, roundId);
  if (!detail) return null;
  const { round, standings } = detail;
  const names = new Map(round.candidates.map((c) => [c.gameId, c.game.name]));
  const votes = new Map(standings.map((s) => [s.gameId, s.votes]));
  return {
    id: round.id,
    groupName: head.group.name,
    label: roundLabel(round),
    url: absoluteUrl(`/groups/${head.groupId}/votes/${round.id}`),
    open: round.status === VoteRoundStatus.OPEN,
    maxVotes: round.maxVotes,
    deadline: round.deadline,
    candidates: round.candidates.map((c) => ({
      gameId: c.gameId,
      name: c.game.name,
      votes: votes.get(c.gameId) ?? 0,
    })),
    ranked: standings.map((s) => ({
      gameId: s.gameId,
      name: names.get(s.gameId) ?? "?",
      votes: s.votes,
      rank: s.rank,
    })),
    voters: new Set(round.ballots.map((b) => b.userId)).size,
    winner: round.winner?.name ?? null,
    repeat: round.repeatVotes,
    // The channel sees what a member who hasn't peeked sees.
    hidden: resultsHidden(round, false),
    peekers: round.anonymous ? (await peekers(roundId)).map((p) => p.user.displayName) : [],
  };
}

const OUTCOME: Record<VotePromptStatus, (who: string) => string | null> = {
  PENDING: () => null,
  CONTINUED: (who) => `${who} 选择继续当前投票`,
  ENDED_NEXT: (who) => `${who} 结束了投票并开启了下一轮`,
  ENDED: (who) => `${who} 结束了投票`,
  EXPIRED: () => "这轮投票已经结束，提示失效",
};

async function promptView(n: Pick<Notification, "title" | "body" | "url">, promptId: string) {
  const prompt = await db.votePrompt.findUnique({
    where: { id: promptId },
    select: { status: true, resolvedBy: { select: { displayName: true } } },
  });
  if (!prompt) return null;
  return {
    id: promptId,
    title: n.title,
    body: n.body,
    url: n.url,
    outcome: OUTCOME[prompt.status](prompt.resolvedBy?.displayName ?? "某人"),
  } satisfies PromptView;
}

/**
 * The channel post for a group notification about a round or a prompt (refId),
 * with its buttons. Null when there is nothing interactive to show.
 */
export async function channelPost(n: Notification) {
  if (!n.refId) return null;
  if (n.event === "NEW_ROUND") {
    const view = await roundView(n.refId);
    return view && renderRound(view, n.mentions);
  }
  if (n.event === "VOTE_PROMPT") {
    const view = await promptView(n, n.refId);
    return view && renderPrompt(view, n.mentions);
  }
  return null;
}

/** Remembers where the live message went, so later changes can edit it. */
export async function rememberPost(n: Notification, channelId: string, messageId: string) {
  const data = { discordChannelId: channelId, discordMessageId: messageId };
  if (n.event === "NEW_ROUND" && n.refId) {
    await db.voteRound.updateMany({ where: { id: n.refId }, data });
  } else if (n.event === "VOTE_PROMPT" && n.refId) {
    await db.votePrompt.updateMany({ where: { id: n.refId }, data });
  }
}

/**
 * Brings a round's Discord messages up to date (worker job, run shortly after
 * a change): the live round message, and prompts answered since.
 */
export async function syncRoundMessages(roundId: string) {
  const e = env();
  if (!e.DISCORD_BOT_TOKEN) return { edited: 0 };
  const opts = { apiUrl: e.DISCORD_API_URL, token: e.DISCORD_BOT_TOKEN };
  let edited = 0;

  const round = await db.voteRound.findUnique({
    where: { id: roundId },
    select: { discordChannelId: true, discordMessageId: true },
  });
  if (round?.discordChannelId && round.discordMessageId) {
    const view = await roundView(roundId);
    if (view) {
      await editMessage(opts, round.discordChannelId, round.discordMessageId, renderRound(view));
      edited++;
    }
  }

  // Answered (or expired) prompts lose their buttons once.
  const prompts = await db.votePrompt.findMany({
    where: {
      roundId,
      discordMessageId: { not: null },
      discordClosedAt: null,
      status: { not: VotePromptStatus.PENDING },
    },
    select: { id: true, discordChannelId: true, discordMessageId: true },
  });
  for (const p of prompts) {
    const n = await db.notification.findFirst({
      where: { refId: p.id, channel: "DISCORD_CHANNEL" },
      select: { title: true, body: true, url: true },
    });
    const view = n && (await promptView(n, p.id));
    if (view && p.discordChannelId && p.discordMessageId) {
      await editMessage(opts, p.discordChannelId, p.discordMessageId, renderPrompt(view));
      edited++;
    }
    await db.votePrompt.update({ where: { id: p.id }, data: { discordClosedAt: new Date() } });
  }
  return { edited };
}

type Interaction = {
  type: number;
  data?: { custom_id?: string };
  member?: { user?: { id: string } };
  user?: { id: string };
};

const CHOICES: Record<string, PromptChoice> = { next: "next", continue: "continue", end: "end" };

/** Answers a Discord interaction (already signature-checked). */
export async function handleInteraction(i: Interaction) {
  if (i.type === 1) return { type: 1 }; // PING
  const button = i.type === 3 ? parseButtonId(i.data?.custom_id ?? "") : null;
  const discordId = i.member?.user?.id ?? i.user?.id;
  if (!button || !discordId) return ephemeral("暂不支持这个操作。");

  const account = await db.account.findUnique({
    where: { provider_providerAccountId: { provider: "discord", providerAccountId: discordId } },
    select: { userId: true },
  });
  if (!account) {
    return ephemeral(
      `你的 Discord 账号还没有绑定 Game Vote，这次操作没有生效。先在网站的设置里绑定 Discord：${absoluteUrl("/settings")}`,
    );
  }
  const userId = account.userId;

  try {
    if (button.kind !== "prompt") {
      const round = await db.voteRound.findUnique({
        where: { id: button.id },
        select: { groupId: true, maxVotes: true, repeatVotes: true },
      });
      if (!round) return ephemeral("这轮投票不存在了。");
      if (!(await isActiveMember(round.groupId, userId))) {
        return ephemeral(`你不是这个群的成员，不能投票。${absoluteUrl("/groups")}`);
      }
      const game = await db.game.findUnique({ where: { id: button.arg }, select: { name: true } });
      const name = game?.name ?? "这个游戏";

      if (!round.repeatVotes) {
        const cast = await toggleVote(round.groupId, button.id, userId, button.arg);
        const { used } = await myVotes(button.id, userId, button.arg);
        const left = `还剩 ${round.maxVotes - used} / ${round.maxVotes} 票`;
        return ephemeral(
          cast ? `✅ 已投给《${name}》（${left}）` : `↩️ 已取消对《${name}》的投票（${left}）`,
        );
      }

      // Repeat votes (#53): the game button adds one; the private reply's −1 / +1
      // buttons adjust and update that reply in place.
      let note: string | undefined;
      try {
        if (button.kind === "vsub") await removeVote(round.groupId, button.id, userId, button.arg);
        else await addVote(round.groupId, button.id, userId, button.arg);
      } catch (err) {
        if (!(err instanceof VoteError)) throw err;
        note = `⚠️ ${err.message}`;
      }
      const mine = await myVotes(button.id, userId, button.arg);
      const data = voteStepper({
        roundId: button.id,
        gameId: button.arg,
        name,
        ...mine,
        maxVotes: round.maxVotes,
        note,
      });
      return { type: button.kind === "vote" ? 4 : 7, data };
    }

    const choice = CHOICES[button.arg];
    const prompt = await db.votePrompt.findUnique({
      where: { id: button.id },
      select: { round: { select: { groupId: true } } },
    });
    if (!prompt || !choice) return ephemeral("这个提示不存在了。");
    if (!(await isActiveMember(prompt.round.groupId, userId))) {
      return ephemeral(`你不是这个群的成员。${absoluteUrl("/groups")}`);
    }
    await resolvePrompt(prompt.round.groupId, button.id, userId, choice);
    return ephemeral(
      choice === "continue"
        ? "好的，继续当前投票。"
        : choice === "next"
          ? "投票已结束，下一轮已经开始。"
          : "投票已结束。",
    );
  } catch (err) {
    if (err instanceof VoteError) return ephemeral(err.message);
    throw err;
  }
}
