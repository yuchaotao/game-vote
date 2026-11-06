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
  steamStoreUrl,
} from "./steam-store";
import {
  fetchIgdbGame,
  requestIgdbToken,
  searchIgdb,
  type IgdbConfig,
  type IgdbGameData,
  type IgdbGameResult,
  type IgdbSearchResult,
} from "./igdb";
import { LocalizedError, msg } from "@/lib/i18n";

export class GameError extends LocalizedError {}

/** The game is already in this group's library (carries its id). */
export class AlreadyInLibraryError extends GameError {
  constructor(
    public readonly gameId: string,
    name: string,
  ) {
    super(msg("《{name}》已经在游戏库里了"), { name });
  }
}

/** Steam metadata older than this is refetched (on add, and by the worker). */
export const STEAM_METADATA_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_CACHE_SECONDS = 600;

export function steamConfig(): SteamStoreConfig {
  const e = env();
  return { baseUrl: e.STEAM_STORE_URL.replace(/\/+$/, ""), country: e.STEAM_STORE_COUNTRY };
}

const STEAM_ERRORS: Record<Exclude<SteamAppResult, { ok: true }>["reason"], string> = {
  "not-found": msg("在 Steam 上找不到这个游戏"),
  "not-a-game": msg("这不是游戏（可能是 DLC、原声或软件）"),
  unavailable: msg("Steam 暂时无法访问，请稍后再试"),
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
      throw new AlreadyInLibraryError(game.id, game.name);
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
    throw new GameError("游戏库里已经有《{name}》了", { name });
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

/**
 * Game row for an app seen in someone's Steam status, created on first sight
 * (from the store when it answers, else just the name Steam reported). Null
 * for apps that aren't games (tools, soundtracks), so they never show up as play.
 */
export async function steamGameFromPresence(appId: string, name: string | null) {
  const where = { source_externalId: { source: GameSource.STEAM, externalId: appId } };
  const existing = await db.game.findUnique({ where });
  if (existing) return existing;
  const notGameKey = `steam:not-a-game:${appId}`;
  if (await redis().exists(notGameKey)) return null;

  const app = await fetchSteamApp(appId, steamConfig());
  if (!app.ok && app.reason === "not-a-game") {
    await redis().set(notGameKey, "1", "EX", 7 * 24 * 3600);
    return null;
  }
  const data = app.ok
    ? steamColumns(app.game)
    : { name: name ?? `Steam App ${appId}`, storeUrl: steamStoreUrl(appId) };
  return db.game.upsert({
    where,
    create: { source: GameSource.STEAM, externalId: appId, ...data },
    update: {},
  });
}

// --- IGDB (non-Steam games) -------------------------------------------------

/** IGDB metadata changes rarely; refresh weekly. */
export const IGDB_METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Per client id, so a test or rotated app never reuses another app's token.
const igdbTokenKey = (clientId: string) => `igdb:token:${clientId}`;

const IGDB_ERRORS: Record<Exclude<IgdbGameResult, { ok: true }>["reason"], string> = {
  "not-found": msg("在 IGDB 上找不到这个游戏"),
  unavailable: msg("IGDB 暂时无法访问，请稍后再试"),
};

/** Null when IGDB credentials aren't configured (the IGDB search is then hidden). */
export function igdbConfig(): IgdbConfig | null {
  const e = env();
  if (!e.IGDB_CLIENT_ID || !e.IGDB_CLIENT_SECRET) return null;
  const { IGDB_CLIENT_ID: clientId, IGDB_CLIENT_SECRET: secret } = e;
  return {
    clientId,
    baseUrl: e.IGDB_API_URL.replace(/\/+$/, ""),
    // App access tokens last ~60 days; cache one in Redis and renew early.
    token: async () => {
      const cached = await redis().get(igdbTokenKey(clientId));
      if (cached) return cached;
      const fresh = await requestIgdbToken(clientId, secret, e.IGDB_TOKEN_URL);
      if (!fresh) return null;
      const ttl = Math.max(60, fresh.expiresIn - 3600);
      await redis().set(igdbTokenKey(clientId), fresh.token, "EX", ttl);
      return fresh.token;
    },
  };
}

export const igdbEnabled = () => igdbConfig() !== null;

function requireIgdb(): IgdbConfig {
  const cfg = igdbConfig();
  if (!cfg) throw new GameError("站点尚未配置 IGDB");
  return cfg;
}

export type IgdbLookup = {
  results: IgdbSearchResult[];
  /** IGDB ids already in this group's library (directly, or as their Steam version). */
  inLibrary: string[];
};

export async function lookupIgdb(groupId: string, term: string): Promise<IgdbLookup> {
  const cfg = requireIgdb();
  const key = `igdb:search:${term.toLowerCase()}`;
  const cached = await redis().get(key);
  let results: IgdbSearchResult[];
  if (cached) {
    results = JSON.parse(cached) as IgdbSearchResult[];
  } else {
    const found = await searchIgdb(term, cfg);
    if (!found) throw new GameError(IGDB_ERRORS.unavailable);
    results = found;
    await redis().set(key, JSON.stringify(results), "EX", SEARCH_CACHE_SECONDS);
  }

  const existing = await db.groupGame.findMany({
    where: {
      groupId,
      game: {
        OR: [
          { source: GameSource.IGDB, externalId: { in: results.map((r) => r.igdbId) } },
          {
            source: GameSource.STEAM,
            externalId: { in: results.flatMap((r) => (r.steamAppId ? [r.steamAppId] : [])) },
          },
        ],
      },
    },
    select: { game: { select: { source: true, externalId: true } } },
  });
  const have = new Set(existing.map((e) => `${e.game.source}:${e.game.externalId}`));
  return {
    results,
    inLibrary: results
      .filter(
        (r) => have.has(`IGDB:${r.igdbId}`) || (r.steamAppId && have.has(`STEAM:${r.steamAppId}`)),
      )
      .map((r) => r.igdbId),
  };
}

function igdbColumns({ externalId, ...columns }: IgdbGameData) {
  void externalId; // the lookup key, not a column to update
  return { ...columns, metadataUpdatedAt: new Date() };
}

/**
 * Adds an IGDB game. Games IGDB knows to be on Steam are added as the Steam
 * game instead, so a library never holds the same game twice.
 */
export async function addIgdbGame(groupId: string, userId: string, igdbId: string) {
  await ownerOf(groupId);
  const where = { source_externalId: { source: GameSource.IGDB, externalId: igdbId } };
  const existing = await db.game.findUnique({ where });
  const fresh =
    existing?.metadataUpdatedAt &&
    Date.now() - existing.metadataUpdatedAt.getTime() < IGDB_METADATA_TTL_MS;

  let game = existing;
  if (!existing || !fresh) {
    const result = await fetchIgdbGame(igdbId, requireIgdb());
    if (!result.ok) {
      if (!existing || result.reason !== "unavailable")
        throw new GameError(IGDB_ERRORS[result.reason]);
    } else {
      if (result.steamAppId) {
        return { game: await addSteamGame(groupId, userId, result.steamAppId), viaSteam: true };
      }
      game = await db.game.upsert({
        where,
        create: { source: GameSource.IGDB, externalId: igdbId, ...igdbColumns(result.game) },
        update: igdbColumns(result.game),
      });
    }
  }
  await addToLibrary(groupId, userId, game!);
  return { game: game!, viaSteam: false };
}

/** Refetches one IGDB game's metadata. Returns false if IGDB didn't answer. */
export async function refreshIgdbGame(gameId: string): Promise<boolean> {
  const cfg = igdbConfig();
  const game = await db.game.findUnique({ where: { id: gameId } });
  if (!cfg || !game || game.source !== GameSource.IGDB || !game.externalId) return false;
  const result = await fetchIgdbGame(game.externalId, cfg);
  if (!result.ok) return false;
  await db.game.update({ where: { id: gameId }, data: igdbColumns(result.game) });
  return true;
}

/** Weekly refresh of IGDB games that are in some library. */
export async function refreshStaleIgdbGames(limit = 30) {
  if (!igdbConfig()) return { checked: 0, refreshed: 0 };
  const stale = await db.game.findMany({
    where: {
      source: GameSource.IGDB,
      groupGames: { some: {} },
      OR: [
        { metadataUpdatedAt: null },
        { metadataUpdatedAt: { lt: new Date(Date.now() - IGDB_METADATA_TTL_MS) } },
      ],
    },
    orderBy: { metadataUpdatedAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true },
  });
  let refreshed = 0;
  // IGDB allows 4 requests / second.
  for (const [i, g] of stale.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 300));
    if (await refreshIgdbGame(g.id)) refreshed++;
  }
  return { checked: stale.length, refreshed };
}
