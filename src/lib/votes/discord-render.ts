// Discord messages for voting (#47): one live message per round, and the
// "you're playing a front-runner" prompt. Pure, so it can be unit tested.

const BUTTON = { PRIMARY: 1, SECONDARY: 2, SUCCESS: 3, LINK: 5 } as const;
const ACTION_ROW = 1;
const COMPONENT_BUTTON = 2;
const INDIGO = 0x4f46e5;
const GRAY = 0x71717a;

/** Discord allows 5 rows of 5 buttons; the last row is kept for the link. */
export const MAX_VOTE_BUTTONS = 20;

export const voteButtonId = (roundId: string, gameId: string) => `vote:${roundId}:${gameId}`;
export const promptButtonId = (promptId: string, choice: string) => `prompt:${promptId}:${choice}`;

export function parseButtonId(customId: string) {
  const [kind, id, arg] = customId.split(":");
  if ((kind === "vote" || kind === "vadd" || kind === "vsub" || kind === "prompt") && id && arg) {
    return { kind, id, arg } as const;
  }
  return null;
}

type Button = {
  type: 2;
  style: number;
  label: string;
  custom_id?: string;
  url?: string;
  disabled?: boolean;
};

const row = (components: Button[]) => ({ type: ACTION_ROW, components });
const link = (url: string): Button => ({
  type: COMPONENT_BUTTON,
  style: BUTTON.LINK,
  label: "在网站上查看",
  url,
});

function rows(buttons: Button[], url: string) {
  const out = [];
  for (let i = 0; i < buttons.length; i += 5) out.push(row(buttons.slice(i, i + 5)));
  out.push(row([link(url)]));
  return out;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** ▰▰▰▱▱ scaled to the leader. */
function bar(votes: number, max: number) {
  const width = 8;
  const filled = max > 0 ? Math.round((votes / max) * width) : 0;
  return "▰".repeat(filled) + "▱".repeat(width - filled);
}

export type RoundView = {
  id: string;
  groupName: string;
  label: string;
  url: string;
  open: boolean;
  maxVotes: number;
  deadline: Date | null;
  /** Candidates in the order they were added (buttons keep their place). */
  candidates: { gameId: string; name: string; votes: number }[];
  /** Ranked, for the text. */
  ranked: { gameId: string; name: string; votes: number; rank: number }[];
  voters: number;
  winner: string | null;
  /** Several votes on one game allowed (#53). */
  repeat?: boolean;
  /** Anonymous and not revealed yet: no counts or order (#51). */
  hidden?: boolean;
  peekers?: string[];
  /** Caught 赌一把 / 偷梁换柱 attempts (#57). */
  exposures?: string[];
};

export function renderRound(r: RoundView, mentionIds: string[] = []) {
  const max = Math.max(0, ...r.ranked.map((s) => s.votes));
  const lines = r.ranked
    .slice(0, 10)
    .map((s) => `**${s.rank}.** ${s.name}　${bar(s.votes, max)} ${s.votes} 票`);
  const parts: string[] = [];
  if (r.hidden && r.candidates.length > 0) {
    parts.push(r.candidates.map((c) => `• ${c.name}`).join("\n"));
    parts.push("🙈 匿名投票：揭榜前不显示票数和排名");
  } else if (r.ranked.length === 0) {
    parts.push(
      r.open ? "还没有候选游戏。在网站上添加候选后，这里会出现投票按钮。" : "这一轮没有候选游戏。",
    );
  } else {
    parts.push(lines.join("\n"));
    if (r.ranked.length > 10) parts.push(`…还有 ${r.ranked.length - 10} 个候选`);
  }
  if (r.open) {
    if (r.deadline) {
      const t = Math.floor(r.deadline.getTime() / 1000);
      parts.push(r.hidden ? `⏰ 揭榜 <t:${t}:F>（<t:${t}:R>）` : `⏰ 截止 <t:${t}:R>`);
    }
    if (r.candidates.length > MAX_VOTE_BUTTONS) {
      parts.push(`候选超过 ${MAX_VOTE_BUTTONS} 个，其余的请在网站上投票。`);
    }
  } else {
    parts.push(r.winner ? `🏆 胜出：**${r.winner}**` : "没有人投票。");
  }
  if (r.peekers && r.peekers.length > 0) parts.push(`👀 偷看过：${r.peekers.join("、")}`);
  if (r.exposures && r.exposures.length > 0) parts.push(r.exposures.join("\n"));

  const buttons: Button[] = r.open
    ? r.candidates.slice(0, MAX_VOTE_BUTTONS).map((c) => ({
        type: COMPONENT_BUTTON,
        style: BUTTON.SECONDARY,
        label: clip(r.hidden ? c.name : `${c.name} · ${c.votes}`, 80),
        custom_id: voteButtonId(r.id, c.gameId),
      }))
    : [];

  return {
    ...(mentionIds.length > 0 && { content: mentionIds.map((id) => `<@${id}>`).join(" ") }),
    embeds: [
      {
        title: clip(`「${r.groupName}」${r.label}${r.open ? "" : "（已结束）"}`, 256),
        url: r.url,
        description: parts.join("\n\n").slice(0, 4000),
        color: r.open ? INDIGO : GRAY,
        footer: {
          text: r.open
            ? r.repeat
              ? `每人 ${r.maxVotes} 票，可以重复投同一个游戏 · 点按钮投一票 · ${r.voters} 人已投`
              : `每人最多 ${r.maxVotes} 票 · 点按钮投票，再点一次取消 · ${r.voters} 人已投`
            : `投票已结束 · ${r.voters} 人投了票`,
        },
      },
    ],
    components: rows(buttons, r.url),
    allowed_mentions: { users: mentionIds },
  };
}

export type PromptView = {
  id: string;
  title: string;
  body: string;
  url: string;
  /** Null while unanswered. */
  outcome: string | null;
};

export function renderPrompt(p: PromptView, mentionIds: string[] = []) {
  const buttons: Button[] =
    p.outcome === null
      ? [
          {
            type: COMPONENT_BUTTON,
            style: BUTTON.SUCCESS,
            label: "结束投票并开启下一轮",
            custom_id: promptButtonId(p.id, "next"),
          },
          {
            type: COMPONENT_BUTTON,
            style: BUTTON.SECONDARY,
            label: "继续当前投票",
            custom_id: promptButtonId(p.id, "continue"),
          },
          {
            type: COMPONENT_BUTTON,
            style: BUTTON.SECONDARY,
            label: "仅结束投票",
            custom_id: promptButtonId(p.id, "end"),
          },
        ]
      : [];
  return {
    ...(mentionIds.length > 0 && { content: mentionIds.map((id) => `<@${id}>`).join(" ") }),
    embeds: [
      {
        title: clip(p.title, 256),
        url: p.url,
        description: p.outcome ? `${p.body}\n\n**${p.outcome}**` : p.body,
        color: p.outcome ? GRAY : INDIGO,
      },
    ],
    components: buttons.length > 0 ? [row(buttons)] : [],
    allowed_mentions: { users: mentionIds },
  };
}

/** A reply only the person who clicked can see. */
export const ephemeral = (content: string) => ({ type: 4, data: { content, flags: 64 } });

/**
 * The private reply in a repeat-vote round (#53): your votes on the game and
 * −1 / +1 buttons to change them.
 */
export function voteStepper(o: {
  roundId: string;
  gameId: string;
  name: string;
  onGame: number;
  used: number;
  maxVotes: number;
  note?: string;
}) {
  const left = o.maxVotes - o.used;
  return {
    content: `${o.note ? `${o.note}\n` : ""}你给《${o.name}》投了 **${o.onGame}** 票（还剩 ${left} / ${o.maxVotes} 票）`,
    flags: 64,
    components: [
      row([
        {
          type: COMPONENT_BUTTON,
          style: BUTTON.SECONDARY,
          label: "−1",
          custom_id: `vsub:${o.roundId}:${o.gameId}`,
          disabled: o.onGame === 0,
        },
        {
          type: COMPONENT_BUTTON,
          style: BUTTON.PRIMARY,
          label: "+1",
          custom_id: `vadd:${o.roundId}:${o.gameId}`,
          disabled: left <= 0,
        },
      ]),
    ],
  };
}
