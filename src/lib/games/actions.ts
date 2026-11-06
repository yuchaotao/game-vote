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
  addIgdbGame,
  addSteamGame,
  GameError,
  getLibraryEntry,
  lookupIgdb,
  lookupSteam,
  refreshIgdbGame,
  refreshSteamGame,
  removeFromLibrary,
  updateManualGame,
  type IgdbLookup,
  type SteamLookup,
} from "./service";
import { parseSteamAppId } from "./steam-store";
import { getT } from "@/lib/i18n/server";

/** Runs a library operation for a group member, turning domain errors into form errors. */
async function asMember<T>(
  groupId: string,
  fn: (userId: string) => Promise<T>,
): Promise<T | { error: string }> {
  const t = await getT();
  const user = await requireUser();
  if (!(await isActiveMember(groupId, user.id))) return { error: t("你不是这个群的成员") };
  try {
    return await fn(user.id);
  } catch (err) {
    if (err instanceof GameError) return { error: err.localize(t) };
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
  const t = await getT();
  const query = raw.trim().slice(0, 200);
  if (!query) return { error: t("请输入游戏名或 Steam 链接") };
  return asMember(groupId, async (userId) => {
    if (!(await rateLimit(`steam-lookup:${userId}`, 30, 60))) {
      throw new GameError("搜索太频繁了，请稍等");
    }
    const appId = parseSteamAppId(query);
    return lookupSteam(groupId, appId ? { appId } : { term: query });
  });
}

export async function addSteamGameAction(groupId: string, appId: string): Promise<FormState> {
  const t = await getT();
  if (!/^\d{1,10}$/.test(appId)) return { error: t("无效的 Steam 游戏") };
  return asMember(groupId, async (userId) => {
    if (!(await rateLimit(`game-add:${userId}`, 30, 600))) {
      throw new GameError("添加太频繁了，请稍后再试");
    }
    const game = await addSteamGame(groupId, userId, appId);
    refresh(groupId);
    return { ok: t("已添加《{name}》", { name: game.name }) };
  });
}

export async function lookupIgdbAction(
  groupId: string,
  raw: string,
): Promise<IgdbLookup | { error: string }> {
  const t = await getT();
  const term = raw.trim().slice(0, 100);
  if (!term) return { error: t("请输入游戏名") };
  return asMember(groupId, async (userId) => {
    if (!(await rateLimit(`igdb-lookup:${userId}`, 30, 60))) {
      throw new GameError("搜索太频繁了，请稍等");
    }
    return lookupIgdb(groupId, term);
  });
}

export async function addIgdbGameAction(groupId: string, igdbId: string): Promise<FormState> {
  const t = await getT();
  if (!/^\d{1,12}$/.test(igdbId)) return { error: t("无效的 IGDB 游戏") };
  return asMember(groupId, async (userId) => {
    if (!(await rateLimit(`game-add:${userId}`, 30, 600))) {
      throw new GameError("添加太频繁了，请稍后再试");
    }
    const { game, viaSteam } = await addIgdbGame(groupId, userId, igdbId);
    refresh(groupId);
    return {
      ok: viaSteam
        ? t("已按 Steam 版添加《{name}》", { name: game.name })
        : t("已添加《{name}》", { name: game.name }),
    };
  });
}

export async function addManualGameAction(
  groupId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const t = await getT();
  const parsed = manualGameSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstError(parsed.error, t) };
  return asMember(groupId, async (userId) => {
    if (!(await rateLimit(`game-add:${userId}`, 30, 600))) {
      throw new GameError("添加太频繁了，请稍后再试");
    }
    const game = await addManualGame(groupId, userId, parsed.data);
    refresh(groupId);
    return { ok: t("已添加《{name}》", { name: game.name }) };
  });
}

export async function updateManualGameAction(
  groupId: string,
  gameId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const t = await getT();
  const parsed = manualGameSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstError(parsed.error, t) };
  return asMember(groupId, async (userId) => {
    await updateManualGame(groupId, userId, gameId, parsed.data);
    refresh(groupId);
    return { ok: t("已保存") };
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
  const t = await getT();
  return asMember(groupId, async (userId) => {
    if (!(await rateLimit(`game-refresh:${userId}`, 10, 600))) {
      throw new GameError("刷新太频繁了，请稍后再试");
    }
    const entry = await getLibraryEntry(groupId, gameId);
    if (!entry) throw new GameError("游戏不在这个群的游戏库里");
    const from = entry.game.source === "IGDB" ? "IGDB" : "Steam";
    const ok =
      entry.game.source === "IGDB" ? await refreshIgdbGame(gameId) : await refreshSteamGame(gameId);
    if (!ok) throw new GameError("{source} 暂时无法访问，请稍后再试", { source: from });
    refresh(groupId);
    return { ok: t("已从 {source} 更新", { source: from }) };
  });
}
