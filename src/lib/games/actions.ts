"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/auth/actions";
import { rateLimit } from "@/lib/auth/rate-limit";
import { requireUser } from "@/lib/auth/session";
import { firstError } from "@/lib/auth/validation";
import { isActiveMember } from "@/lib/groups/service";
import { manualGameSchema } from "./rules";
import {
  addManualGame,
  addSteamGame,
  GameError,
  getLibraryEntry,
  lookupSteam,
  refreshSteamGame,
  removeFromLibrary,
  updateManualGame,
  type SteamLookup,
} from "./service";
import { parseSteamAppId } from "./steam-store";

const NOT_MEMBER = { error: "你不是这个群的成员" };

/** Runs a library operation for a group member, turning domain errors into form errors. */
async function asMember<T>(
  groupId: string,
  fn: (userId: string) => Promise<T>,
): Promise<T | { error: string }> {
  const user = await requireUser();
  if (!(await isActiveMember(groupId, user.id))) return NOT_MEMBER;
  try {
    return await fn(user.id);
  } catch (err) {
    if (err instanceof GameError) return { error: err.message };
    throw err;
  }
}

function refresh(groupId: string) {
  revalidatePath(`/groups/${groupId}`, "layout");
}

export async function lookupSteamAction(
  groupId: string,
  raw: string,
): Promise<SteamLookup | { error: string }> {
  const query = raw.trim().slice(0, 200);
  if (!query) return { error: "请输入游戏名或 Steam 链接" };
  return asMember(groupId, async (userId) => {
    if (!(await rateLimit(`steam-lookup:${userId}`, 30, 60))) {
      throw new GameError("搜索太频繁了，请稍等");
    }
    const appId = parseSteamAppId(query);
    return lookupSteam(groupId, appId ? { appId } : { term: query });
  });
}

export async function addSteamGameAction(groupId: string, appId: string): Promise<FormState> {
  if (!/^\d{1,10}$/.test(appId)) return { error: "无效的 Steam 游戏" };
  return asMember(groupId, async (userId) => {
    if (!(await rateLimit(`game-add:${userId}`, 30, 600))) {
      throw new GameError("添加太频繁了，请稍后再试");
    }
    const game = await addSteamGame(groupId, userId, appId);
    refresh(groupId);
    return { ok: `已添加《${game.name}》` };
  });
}

export async function addManualGameAction(
  groupId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = manualGameSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstError(parsed.error) };
  return asMember(groupId, async (userId) => {
    if (!(await rateLimit(`game-add:${userId}`, 30, 600))) {
      throw new GameError("添加太频繁了，请稍后再试");
    }
    const game = await addManualGame(groupId, userId, parsed.data);
    refresh(groupId);
    return { ok: `已添加《${game.name}》` };
  });
}

export async function updateManualGameAction(
  groupId: string,
  gameId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = manualGameSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstError(parsed.error) };
  return asMember(groupId, async (userId) => {
    await updateManualGame(groupId, userId, gameId, parsed.data);
    refresh(groupId);
    return { ok: "已保存" };
  });
}

export async function removeFromLibraryAction(groupId: string, gameId: string): Promise<FormState> {
  const result = await asMember(groupId, async (userId) => {
    await removeFromLibrary(groupId, userId, gameId);
  });
  if (result) return result;
  refresh(groupId);
  redirect(`/groups/${groupId}/games`);
}

export async function refreshGameAction(groupId: string, gameId: string): Promise<FormState> {
  return asMember(groupId, async (userId) => {
    if (!(await rateLimit(`game-refresh:${userId}`, 10, 600))) {
      throw new GameError("刷新太频繁了，请稍后再试");
    }
    if (!(await getLibraryEntry(groupId, gameId))) throw new GameError("游戏不在这个群的游戏库里");
    if (!(await refreshSteamGame(gameId))) throw new GameError("Steam 暂时无法访问，请稍后再试");
    refresh(groupId);
    return { ok: "已从 Steam 更新" };
  });
}
