// IGDB (Twitch) game database: search and details for games that aren't on
// Steam (Battlefield on the EA App, Battle.net, consoles, ...).
// https://api-docs.igdb.com — auth is a Twitch app access token (client credentials).

import { parseSteamAppId } from "./steam-store";

export type IgdbConfig = {
  clientId: string;
  /** Returns a valid app access token (cached by the caller). */
  token: () => Promise<string | null>;
  /** https://api.igdb.com/v4, or a mock in tests. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
};

export type IgdbGameData = {
  externalId: string;
  name: string;
  coverUrl: string | null;
  description: string;
  genres: string[];
  features: string[];
  platforms: string[];
  developers: string[];
  releaseDate: string | null;
  screenshots: string[];
  storeUrl: string | null;
  reviewPercent: number | null;
  reviewCount: number | null;
  reviewLabel: string | null;
};

export type IgdbSearchResult = {
  igdbId: string;
  name: string;
  imageUrl: string | null;
  year: number | null;
  platforms: string[];
  /** Set when IGDB knows the game's Steam appid: add it as a Steam game instead. */
  steamAppId: string | null;
};

type Named = { name?: string; abbreviation?: string };
type RawGame = {
  id: number;
  name?: string;
  summary?: string;
  first_release_date?: number;
  cover?: { image_id?: string };
  artworks?: { image_id?: string }[];
  screenshots?: { image_id?: string }[];
  genres?: Named[];
  game_modes?: Named[];
  platforms?: Named[];
  involved_companies?: { developer?: boolean; company?: Named }[];
  external_games?: { external_game_source?: number; uid?: string }[];
  websites?: { type?: number; url?: string }[];
  total_rating?: number;
  total_rating_count?: number;
  url?: string;
};

// Main games, standalone expansions, remakes, remasters, expanded games, ports.
const GAME_TYPES = "(0,4,8,9,10,11)";
const STEAM_SOURCE = 1;
const WEBSITE = { official: 1, steam: 13 };

const SEARCH_FIELDS =
  "name,first_release_date,cover.image_id,platforms.abbreviation,platforms.name,external_games.external_game_source,external_games.uid,websites.type,websites.url";
const DETAIL_FIELDS = [
  SEARCH_FIELDS,
  "summary,artworks.image_id,screenshots.image_id,genres.name,game_modes.name",
  "involved_companies.developer,involved_companies.company.name,total_rating,total_rating_count,url",
].join(",");

const GENRES: Record<string, string> = {
  Shooter: "射击",
  "Role-playing (RPG)": "角色扮演",
  Strategy: "策略",
  "Real Time Strategy (RTS)": "即时战略",
  "Turn-based strategy (TBS)": "回合制策略",
  Tactical: "战术",
  Adventure: "冒险",
  Simulator: "模拟",
  Sport: "体育",
  Racing: "竞速",
  Fighting: "格斗",
  Puzzle: "解谜",
  Platform: "平台跳跃",
  Indie: "独立",
  Arcade: "街机",
  "Hack and slash/Beat 'em up": "动作砍杀",
  MOBA: "MOBA",
  "Card & Board Game": "卡牌 / 桌游",
  Music: "音乐",
  "Visual Novel": "视觉小说",
  "Point-and-click": "点击冒险",
  "Quiz/Trivia": "问答",
};

const MODES: Record<string, string> = {
  "Single player": "单人",
  Multiplayer: "多人",
  "Co-operative": "合作",
  "Split screen": "分屏",
  "Massively Multiplayer Online (MMO)": "大型多人在线",
  "Battle Royale": "大逃杀",
};
// Same "ways to play" order as Steam: group play first, single player last.
const MODE_ORDER = ["多人", "合作", "分屏", "大逃杀", "大型多人在线", "单人"];

export const igdbImage = (
  id: string,
  size: "t_thumb" | "t_cover_big" | "t_screenshot_med" | "t_720p",
) => `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg`;

/** Quotes a search term for the IGDB query language. */
export function igdbSearchQuery(term: string, fields: string, limit: number): string {
  const safe = term.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  return `search "${safe}"; fields ${fields}; where game_type = ${GAME_TYPES} & version_parent = null; limit ${limit};`;
}

function platformName(p: Named): string | null {
  if (p.abbreviation === "PC" || p.name === "PC (Microsoft Windows)") return "PC";
  return p.abbreviation || p.name || null;
}

function steamAppIdOf(g: RawGame): string | null {
  const ext = g.external_games?.find((e) => e.external_game_source === STEAM_SOURCE && e.uid);
  if (ext?.uid && /^\d{1,10}$/.test(ext.uid)) return ext.uid;
  const site = g.websites?.find((w) => w.type === WEBSITE.steam && w.url);
  return site?.url ? parseSteamAppId(site.url) : null;
}

const uniq = (xs: (string | null | undefined)[]) => [
  ...new Set(xs.filter((x): x is string => !!x)),
];

function year(unix?: number): number | null {
  return unix ? new Date(unix * 1000).getUTCFullYear() : null;
}

export function mapSearchResult(g: RawGame): IgdbSearchResult {
  return {
    igdbId: String(g.id),
    name: g.name ?? `IGDB ${g.id}`,
    imageUrl: g.cover?.image_id ? igdbImage(g.cover.image_id, "t_thumb") : null,
    year: year(g.first_release_date),
    platforms: uniq((g.platforms ?? []).map(platformName)),
    steamAppId: steamAppIdOf(g),
  };
}

export function mapGameDetails(g: RawGame): IgdbGameData {
  // Cards are landscape: prefer artwork / a screenshot over the portrait cover.
  const wide = g.artworks?.[0]?.image_id ?? g.screenshots?.[0]?.image_id;
  const modes = uniq((g.game_modes ?? []).map((m) => (m.name ? (MODES[m.name] ?? m.name) : null)));
  const official = g.websites?.find((w) => w.type === WEBSITE.official)?.url;
  const rating = g.total_rating;
  return {
    externalId: String(g.id),
    name: g.name ?? `IGDB ${g.id}`,
    coverUrl: wide
      ? igdbImage(wide, "t_720p")
      : g.cover?.image_id
        ? igdbImage(g.cover.image_id, "t_cover_big")
        : null,
    description: (g.summary ?? "").trim(),
    genres: uniq((g.genres ?? []).map((x) => (x.name ? (GENRES[x.name] ?? x.name) : null))),
    features: [...modes].sort(
      (a, b) => (MODE_ORDER.indexOf(a) + 1 || 99) - (MODE_ORDER.indexOf(b) + 1 || 99),
    ),
    platforms: uniq((g.platforms ?? []).map(platformName)),
    developers: uniq(
      (g.involved_companies ?? []).filter((c) => c.developer).map((c) => c.company?.name),
    ),
    releaseDate: g.first_release_date
      ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10)
      : null,
    screenshots: (g.screenshots ?? [])
      .flatMap((s) => (s.image_id ? [igdbImage(s.image_id, "t_screenshot_med")] : []))
      .slice(0, 6),
    storeUrl: official ?? g.url ?? null,
    reviewPercent: rating !== undefined ? Math.round(rating) : null,
    reviewCount: g.total_rating_count ?? null,
    reviewLabel: rating !== undefined ? "IGDB 评分" : null,
  };
}

async function query(cfg: IgdbConfig, body: string): Promise<RawGame[] | null> {
  const token = await cfg.token();
  if (!token) return null;
  try {
    const res = await (cfg.fetchImpl ?? fetch)(`${cfg.baseUrl}/games`, {
      method: "POST",
      headers: { "Client-ID": cfg.clientId, Authorization: `Bearer ${token}` },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as RawGame[];
  } catch {
    return null;
  }
}

export async function searchIgdb(
  term: string,
  cfg: IgdbConfig,
): Promise<IgdbSearchResult[] | null> {
  const games = await query(cfg, igdbSearchQuery(term, SEARCH_FIELDS, 10));
  return games ? games.map(mapSearchResult) : null;
}

export type IgdbGameResult =
  | { ok: true; game: IgdbGameData; steamAppId: string | null }
  | { ok: false; reason: "not-found" | "unavailable" };

export async function fetchIgdbGame(igdbId: string, cfg: IgdbConfig): Promise<IgdbGameResult> {
  const games = await query(cfg, `fields ${DETAIL_FIELDS}; where id = ${Number(igdbId)};`);
  if (!games) return { ok: false, reason: "unavailable" };
  const g = games[0];
  if (!g) return { ok: false, reason: "not-found" };
  return { ok: true, game: mapGameDetails(g), steamAppId: steamAppIdOf(g) };
}

/** Requests a Twitch app access token. */
export async function requestIgdbToken(
  clientId: string,
  clientSecret: string,
  tokenUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ token: string; expiresIn: number } | null> {
  try {
    const res = await fetchImpl(tokenUrl, {
      method: "POST",
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    return data.access_token
      ? { token: data.access_token, expiresIn: data.expires_in ?? 3600 }
      : null;
  } catch {
    return null;
  }
}
