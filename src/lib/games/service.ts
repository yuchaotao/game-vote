import { GameSource, Prisma } from "@prisma/client";
import { postSystemMessage } from "@/lib/chat/service";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { publicUser } from "@/lib/friends/service";
import { redis } from "@/lib/redis";
import { canManageGroupGame, normalizeGameName, type ManualGameInput } from "./rules";
import {
  fetchSteamApp,
  searchSteam,
  type SteamAppResult,
  type SteamGameData,
  type SteamSearchResult,
  type SteamStoreConfig,
} from "./steam-store";

export class GameError extends Error {}

/** Steam metadata older than this is refetched (on add, and by the worker). */
export const STEAM_METADATA_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_CACHE_SECONDS = 600;

export function steamConfig(): SteamStoreConfig {
  const e = env();
  return { baseUrl: e.STEAM_STORE_URL.replace(/\/+$/, ""), country: e.STEAM_STORE_COUNTRY };
}

const STEAM_ERRORS: Record<Exclude<SteamAppResult, { ok: true }>["reason"], string> = {
  "not-found": "在 Steam 上找不到这个游戏",
  "not-a-game": "这不是游戏（可能是 DLC、原声或软件）",
  unavailable: "Steam 暂时无法访问，请稍后再试",
};

const libraryInclude = {
  game: true,
  addedBy: { select: publicUser },
} satisfies Prisma.GroupGameInclude;

export type LibraryEntry = Prisma.GroupGameGetPayload<{ include: typeof libraryInclude }>;

export function listLibrary(groupId: string): Promise<LibraryEntry[]> {
  return db.groupGame.findMany({
    where: { groupId },
    include: libraryInclude,
    orderBy: { addedAt: "desc" },
  });
}

export function getLibraryEntry(groupId: string, gameId: string): Promise<LibraryEntry | null> {
  return db.groupGame.findUnique({
    where: { groupId_gameId: { groupId, gameId } },
    include: libraryInclude,
  });
}

async function nameOf(userId: string): Promise<string> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  return u?.displayName ?? "某人";
}

async function ownerOf(groupId: string): Promise<string> {
  const g = await db.group.findFirst({ where: { id: groupId, dissolvedAt: null } });
  if (!g) throw new GameError("群不存在");
  return g.ownerId;
}

export type SteamLookup = {
  results: SteamSearchResult[];
  /** Appids already in this group's library. */
  inLibrary: string[];
};

/** Search results for a term, or the single app a pasted link / appid points to. */
export async function lookupSteam(
  groupId: string,
  query: { appId: string } | { term: string },
): Promise<SteamLookup> {
  const cfg = steamConfig();
  let results: SteamSearchResult[];
  if ("appId" in query) {
    const app = await fetchSteamApp(query.appId, cfg);
    if (!app.ok) throw new GameError(STEAM_ERRORS[app.reason]);
    const g = app.game;
    results = [
      {
        appId: g.externalId,
        name: g.name,
        imageUrl: g.coverUrl,
        priceFinal: g.priceFinal,
        priceCurrency: g.priceCurrency,
      },
    ];
  } else {
    const key = `steam:search:${cfg.country}:${query.term.toLowerCase()}`;
    const cached = await redis().get(key);
    if (cached) {
      results = JSON.parse(cached) as SteamSearchResult[];
    } else {
      const found = await searchSteam(query.term, cfg);
      if (!found) throw new GameError(STEAM_ERRORS.unavailable);
      results = found;
      await redis().set(key, JSON.stringify(results), "EX", SEARCH_CACHE_SECONDS);
    }
  }

  const existing = await db.groupGame.findMany({
    where: {
      groupId,
      game: { source: GameSource.STEAM, externalId: { in: results.map((r) => r.appId) } },
    },
    select: { game: { select: { externalId: true } } },
  });
  return { results, inLibrary: existing.map((e) => e.game.externalId!) };
}

function steamColumns({ externalId, ...columns }: SteamGameData) {
  void externalId; // the lookup key, not a column to update
  return { ...columns, metadataUpdatedAt: new Date() };
}

/** Returns the shared Game row for a Steam app, fetching / refreshing metadata as needed. */
async function steamGame(appId: string) {
  const existing = await db.game.findUnique({
    where: { source_externalId: { source: GameSource.STEAM, externalId: appId } },
  });
  const fresh =
    existing?.metadataUpdatedAt &&
    Date.now() - existing.metadataUpdatedAt.getTime() < STEAM_METADATA_TTL_MS;
  if (existing && fresh) return existing;

  const app = await fetchSteamApp(appId, steamConfig());
  if (!app.ok) {
    // Keep using what we have if Steam is just down.
    if (existing && app.reason === "unavailable") return existing;
    throw new GameError(STEAM_ERRORS[app.reason]);
  }
  return db.game.upsert({
    where: { source_externalId: { source: GameSource.STEAM, externalId: appId } },
    create: { source: GameSource.STEAM, externalId: appId, ...steamColumns(app.game) },
    update: steamColumns(app.game),
  });
}

async function addToLibrary(groupId: string, userId: string, game: { id: string; name: string }) {
  try {
    await db.groupGame.create({ data: { groupId, gameId: game.id, addedById: userId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new GameError(`《${game.name}》已经在游戏库里了`);
    }
    throw err;
  }
  await postSystemMessage(groupId, `${await nameOf(userId)} 把《${game.name}》加入了游戏库`, [
    userId,
  ]);
}

export async function addSteamGame(groupId: string, userId: string, appId: string) {
  await ownerOf(groupId);
  const game = await steamGame(appId);
  await addToLibrary(groupId, userId, game);
  return game;
}

async function assertNameFree(groupId: string, name: string, exceptGameId?: string) {
  const entries = await db.groupGame.findMany({
    where: { groupId, gameId: exceptGameId ? { not: exceptGameId } : undefined },
    select: { game: { select: { name: true } } },
  });
  const wanted = normalizeGameName(name);
  if (entries.some((e) => normalizeGameName(e.game.name) === wanted)) {
    throw new GameError(`游戏库里已经有《${name}》了`);
  }
}

export async function addManualGame(groupId: string, userId: string, input: ManualGameInput) {
  await ownerOf(groupId);
  await assertNameFree(groupId, input.name);
  const game = await db.game.create({ data: { source: GameSource.MANUAL, ...input } });
  await addToLibrary(groupId, userId, game);
  return game;
}

async function manageableEntry(groupId: string, userId: string, gameId: string) {
  const ownerId = await ownerOf(groupId);
  const entry = await getLibraryEntry(groupId, gameId);
  if (!entry) throw new GameError("游戏不在这个群的游戏库里");
  if (!canManageGroupGame(userId, entry, ownerId)) {
    throw new GameError("只有添加者或群主可以修改");
  }
  return entry;
}

export async function updateManualGame(
  groupId: string,
  userId: string,
  gameId: string,
  input: ManualGameInput,
) {
  const entry = await manageableEntry(groupId, userId, gameId);
  if (entry.game.source !== GameSource.MANUAL) {
    throw new GameError("Steam 游戏的资料会自动同步，不能手动修改");
  }
  await assertNameFree(groupId, input.name, gameId);
  return db.game.update({ where: { id: gameId }, data: input });
}

/** Removes a game from the group's library. The Game row stays for history (votes, play logs). */
export async function removeFromLibrary(groupId: string, userId: string, gameId: string) {
  const entry = await manageableEntry(groupId, userId, gameId);
  await db.groupGame.delete({ where: { groupId_gameId: { groupId, gameId } } });
  await postSystemMessage(groupId, `${await nameOf(userId)} 把《${entry.game.name}》移出了游戏库`, [
    userId,
  ]);
}

/** Refetches one Steam game's metadata. Returns false if Steam didn't answer. */
export async function refreshSteamGame(gameId: string): Promise<boolean> {
  const game = await db.game.findUnique({ where: { id: gameId } });
  if (!game || game.source !== GameSource.STEAM || !game.externalId) return false;
  const app = await fetchSteamApp(game.externalId, steamConfig());
  if (!app.ok) return false;
  await db.game.update({ where: { id: gameId }, data: steamColumns(app.game) });
  return true;
}

/**
 * Refreshes the stalest Steam games that are in some library. Called by the
 * worker; spaced out to stay well under the store's ~200 requests / 5 min.
 */
export async function refreshStaleSteamGames(limit = 30, gapMs = 2000) {
  const stale = await db.game.findMany({
    where: {
      source: GameSource.STEAM,
      groupGames: { some: {} },
      OR: [
        { metadataUpdatedAt: null },
        { metadataUpdatedAt: { lt: new Date(Date.now() - STEAM_METADATA_TTL_MS) } },
      ],
    },
    orderBy: { metadataUpdatedAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true },
  });
  let refreshed = 0;
  for (const [i, g] of stale.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, gapMs));
    if (await refreshSteamGame(g.id)) refreshed++;
  }
  return { checked: stale.length, refreshed };
}
