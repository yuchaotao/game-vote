"use server";

import { VoteEndReason } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/auth/actions";
import { rateLimit } from "@/lib/auth/rate-limit";
import { requireUser } from "@/lib/auth/session";
import { firstError } from "@/lib/auth/validation";
import {
  addIgdbGame,
  addManualGame,
  addSteamGame,
  AlreadyInLibraryError,
  GameError,
} from "@/lib/games/service";
import { manualGameSchema } from "@/lib/games/rules";
import { isActiveMember } from "@/lib/groups/service";
import { resolvePrompt, type PromptChoice } from "./prompts";
import { gamblePeek, gambleSwap } from "./gamble";
import { roundSettingsSchema } from "./rules";
import {
  addAllCandidates,
  addCandidate,
  addVote,
  confirmVotes,
  endAndStartNext,
  endRound,
  removeCandidate,
  removeVote,
  startRound,
  toggleVote,
  VoteError,
} from "./service";
import { getT } from "@/lib/i18n/server";

/** Runs a voting operation for a group member, turning domain errors into form errors. */
async function asMember(
  groupId: string,
  fn: (userId: string) => Promise<FormState | void>,
): Promise<FormState> {
  const t = await getT();
  const user = await requireUser();
  if (!(await isActiveMember(groupId, user.id))) return { error: t("你不是这个群的成员") };
  try {
    return (await fn(user.id)) ?? { ok: t("已完成") };
  } catch (err) {
    if (err instanceof VoteError || err instanceof GameError) return { error: err.localize(t) };
    throw err;
  }
}

const refresh = (groupId: string) => revalidatePath(`/groups/${groupId}`, "layout");

export async function startRoundAction(
  groupId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const t = await getT();
  const parsed = roundSettingsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstError(parsed.error, t) };
  let roundId = "";
  const result = await asMember(groupId, async (userId) => {
    if (!(await rateLimit(`round-start:${userId}`, 10, 3600))) {
      throw new VoteError("发起太频繁了，请稍后再试");
    }
    roundId = (await startRound(groupId, userId, parsed.data)).id;
  });
  if (!roundId) return result;
  refresh(groupId);
  redirect(`/groups/${groupId}/votes/${roundId}`);
}

export async function endRoundAction(
  groupId: string,
  roundId: string,
  startNext: boolean,
): Promise<FormState> {
  const t = await getT();
  let nextId = "";
  const result = await asMember(groupId, async (userId) => {
    if (startNext) nextId = (await endAndStartNext(groupId, roundId, userId)).next.id;
    else await endRound(groupId, roundId, userId, VoteEndReason.MANUAL);
  });
  if (result?.error) return result;
  refresh(groupId);
  if (nextId) redirect(`/groups/${groupId}/votes/${nextId}`);
  return { ok: t("投票已结束") };
}

export async function toggleVoteAction(
  groupId: string,
  roundId: string,
  gameId: string,
): Promise<FormState> {
  const t = await getT();
  return asMember(groupId, async (userId) => {
    if (!(await rateLimit(`vote:${userId}`, 60, 60))) throw new VoteError("操作太频繁了，请稍等");
    const cast = await toggleVote(groupId, roundId, userId, gameId);
    refresh(groupId);
    return { ok: cast ? t("已投票") : t("已取消") };
  });
}

export async function addCandidateAction(
  groupId: string,
  roundId: string,
  gameId: string,
): Promise<FormState> {
  const t = await getT();
  return asMember(groupId, async (userId) => {
    const game = await addCandidate(groupId, roundId, userId, gameId);
    refresh(groupId);
    return { ok: t("已把《{name}》加入候选", { name: game.name }) };
  });
}

export async function addAllCandidatesAction(groupId: string, roundId: string): Promise<FormState> {
  const t = await getT();
  return asMember(groupId, async (userId) => {
    const added = await addAllCandidates(groupId, roundId, userId);
    refresh(groupId);
    return {
      ok:
        added > 0 ? t("已把 {n} 个游戏加入候选", { n: added }) : t("游戏库里的游戏都已经是候选了"),
    };
  });
}

export async function removeCandidateAction(
  groupId: string,
  roundId: string,
  gameId: string,
): Promise<FormState> {
  const t = await getT();
  return asMember(groupId, async (userId) => {
    await removeCandidate(groupId, roundId, userId, gameId);
    refresh(groupId);
    return { ok: t("已移除候选") };
  });
}

/**
 * Adds a game from the voting screen: into the library if it isn't there yet
 * ("synced to the library"), then as a candidate.
 */
async function addNewAsCandidate(
  groupId: string,
  roundId: string,
  userId: string,
  addToLibrary: () => Promise<{ id: string }>,
): Promise<FormState> {
  const t = await getT();
  if (!(await rateLimit(`game-add:${userId}`, 30, 600))) {
    throw new VoteError("添加太频繁了，请稍后再试");
  }
  let gameId: string;
  let known = false;
  try {
    gameId = (await addToLibrary()).id;
  } catch (err) {
    // Already in the library (maybe as its Steam version): just nominate it.
    if (!(err instanceof AlreadyInLibraryError)) throw err;
    gameId = err.gameId;
    known = true;
  }
  const game = await addCandidate(groupId, roundId, userId, gameId);
  refresh(groupId);
  return {
    ok: known
      ? t("《{name}》已在游戏库，已加入候选", { name: game.name })
      : t("已把《{name}》加入游戏库和候选", { name: game.name }),
  };
}

export async function addSteamCandidateAction(
  groupId: string,
  roundId: string,
  appId: string,
): Promise<FormState> {
  const t = await getT();
  if (!/^\d{1,10}$/.test(appId)) return { error: t("无效的 Steam 游戏") };
  return asMember(groupId, (userId) =>
    addNewAsCandidate(groupId, roundId, userId, () => addSteamGame(groupId, userId, appId)),
  );
}

export async function addIgdbCandidateAction(
  groupId: string,
  roundId: string,
  igdbId: string,
): Promise<FormState> {
  const t = await getT();
  if (!/^\d{1,12}$/.test(igdbId)) return { error: t("无效的 IGDB 游戏") };
  return asMember(groupId, (userId) =>
    addNewAsCandidate(
      groupId,
      roundId,
      userId,
      async () => (await addIgdbGame(groupId, userId, igdbId)).game,
    ),
  );
}

export async function addManualCandidateAction(
  groupId: string,
  roundId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const t = await getT();
  const parsed = manualGameSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstError(parsed.error, t) };
  return asMember(groupId, (userId) =>
    addNewAsCandidate(groupId, roundId, userId, () => addManualGame(groupId, userId, parsed.data)),
  );
}

export async function resolvePromptAction(
  groupId: string,
  promptId: string,
  choice: PromptChoice,
): Promise<FormState> {
  const t = await getT();
  if (!["continue", "next", "end"].includes(choice)) return { error: t("无效的选择") };
  let nextId: string | null = null;
  const result = await asMember(groupId, async (userId) => {
    nextId = await resolvePrompt(groupId, promptId, userId, choice);
  });
  if (result?.error) return result;
  refresh(groupId);
  if (nextId) redirect(`/groups/${groupId}/votes/${nextId}`);
  return { ok: choice === "continue" ? t("已继续当前投票") : t("投票已结束") };
}

export async function gamblePeekAction(groupId: string, roundId: string): Promise<FormState> {
  const t = await getT();
  let won = false;
  const result = await asMember(groupId, async (userId) => {
    won = await gamblePeek(groupId, roundId, userId);
    refresh(groupId);
  });
  if (result?.error) return result;
  return won ? { ok: t("🎲 赌赢了！") } : { error: t("🎲 赌输了……大家都知道你想偷看了。") };
}

export async function gambleSwapAction(groupId: string, roundId: string): Promise<FormState> {
  const t = await getT();
  let outcome = { won: false, toGame: "" };
  const result = await asMember(groupId, async (userId) => {
    outcome = await gambleSwap(groupId, roundId, userId);
    refresh(groupId);
  });
  if (result?.error) return result;
  return outcome.won
    ? { ok: t("😈 偷梁换柱成功！你悄悄把一张别人的票换成了《{name}》。", { name: outcome.toGame }) }
    : { error: t("😈 失手了，被大家抓了个正着。") };
}

/** Repeat-vote rounds (#53): one more vote, or one back, for a game. */
export async function confirmVotesAction(groupId: string, roundId: string): Promise<FormState> {
  return asMember(groupId, async (userId) => {
    if (!(await rateLimit(`vote:${userId}`, 60, 60))) throw new VoteError("操作太频繁了，请稍等");
    await confirmVotes(groupId, roundId, userId);
    refresh(groupId);
  });
}

export async function stepVoteAction(
  groupId: string,
  roundId: string,
  gameId: string,
  step: 1 | -1,
): Promise<FormState> {
  return asMember(groupId, async (userId) => {
    if (!(await rateLimit(`vote:${userId}`, 60, 60))) throw new VoteError("操作太频繁了，请稍等");
    if (step === 1) await addVote(groupId, roundId, userId, gameId);
    else await removeVote(groupId, roundId, userId, gameId);
    refresh(groupId);
  });
}
