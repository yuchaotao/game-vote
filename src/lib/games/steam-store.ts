// Steam store (public, no API key): app details, review summary, search.
// These endpoints are undocumented but stable; every call is best-effort and
// failures surface as a "Steam unavailable" result rather than exceptions.

export type SteamStoreConfig = {
  /** https://store.steampowered.com, or a mock in tests. */
  baseUrl: string;
  /** Country for prices, e.g. "us". */
  country: string;
  fetchImpl?: typeof fetch;
};

/** Fields we store on Game for a Steam app. */
export type SteamGameData = {
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
  storeUrl: string;
  isFree: boolean;
  priceFinal: number | null;
  priceInitial: number | null;
  priceCurrency: string | null;
  discountPercent: number | null;
  reviewPercent: number | null;
  reviewCount: number | null;
  reviewLabel: string | null;
  metacritic: number | null;
};

export type SteamSearchResult = {
  appId: string;
  name: string;
  imageUrl: string | null;
  priceFinal: number | null;
  priceCurrency: string | null;
};

export type SteamAppResult =
  | { ok: true; game: SteamGameData }
  | { ok: false; reason: "not-found" | "not-a-game" | "unavailable" };

const LANG = "schinese";
const TIMEOUT_MS = 10_000;

// Steam category ids that say how people can play together, in display order.
// Single-player (2) is kept so solo games are recognisable.
const FEATURE_CATEGORY_IDS = [1, 9, 38, 36, 49, 27, 24, 39, 37, 48, 47, 20, 2];

/**
 * Extracts a Steam appid from a store / community / steamdb link, a steam://
 * URL, or a bare number. Returns null for anything else (e.g. a search term).
 */
export function parseSteamAppId(input: string): string | null {
  const s = input.trim();
  if (/^\d{1,10}$/.test(s)) return s;
  const steamUri = /^steam:\/\/(?:run|store|rungameid|install)\/(\d{1,10})\b/i.exec(s);
  if (steamUri) return steamUri[1];

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname;
  const patterns: Record<string, RegExp> = {
    "store.steampowered.com": /^\/(?:agecheck\/)?app\/(\d{1,10})(?:\/|$)/,
    "steamcommunity.com": /^\/app\/(\d{1,10})(?:\/|$)/,
    "s.team": /^\/a\/(\d{1,10})(?:\/|$)/,
    "steamdb.info": /^\/app\/(\d{1,10})(?:\/|$)/,
  };
  return patterns[host]?.exec(path)?.[1] ?? null;
}

export function steamStoreUrl(appId: string): string {
  return `https://store.steampowered.com/app/${appId}/`;
}

type RawAppDetails = {
  type?: string;
  name?: string;
  steam_appid?: number;
  is_free?: boolean;
  short_description?: string;
  header_image?: string;
  developers?: string[];
  genres?: { id: string; description: string }[];
  categories?: { id: number; description: string }[];
  platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
  price_overview?: { currency: string; initial: number; final: number; discount_percent: number };
  release_date?: { coming_soon?: boolean; date?: string };
  metacritic?: { score?: number };
  recommendations?: { total?: number };
  screenshots?: { path_thumbnail?: string; path_full?: string }[];
};

type RawReviewSummary = {
  review_score_desc?: string;
  total_positive?: number;
  total_negative?: number;
  total_reviews?: number;
};

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/** Maps an appdetails `data` object (plus optional review summary) to our fields. */
export function mapAppDetails(
  appId: string,
  d: RawAppDetails,
  reviews: RawReviewSummary | null,
): SteamGameData {
  const byId = new Map((d.categories ?? []).map((c) => [c.id, c.description]));
  const features = FEATURE_CATEGORY_IDS.flatMap((id) => {
    const label = byId.get(id);
    return label ? [label] : [];
  });
  const platforms = [
    d.platforms?.windows && "Windows",
    d.platforms?.mac && "macOS",
    d.platforms?.linux && "Linux",
  ].filter((p): p is string => typeof p === "string");
  const price = d.price_overview;

  const total = reviews?.total_reviews ?? 0;
  const positive = reviews?.total_positive ?? 0;
  const hasReviews = reviews !== null && total > 0;

  return {
    externalId: appId,
    name: d.name?.trim() || `Steam App ${appId}`,
    coverUrl: d.header_image || null,
    description: (d.short_description ?? "").trim(),
    genres: uniq((d.genres ?? []).map((g) => g.description)),
    features: uniq(features),
    platforms,
    developers: uniq(d.developers ?? []),
    releaseDate: d.release_date?.date?.trim() || null,
    screenshots: (d.screenshots ?? [])
      .map((s) => s.path_thumbnail ?? s.path_full ?? "")
      .filter(Boolean)
      .slice(0, 6),
    storeUrl: steamStoreUrl(appId),
    isFree: Boolean(d.is_free),
    priceFinal: price?.final ?? null,
    priceInitial: price?.initial ?? null,
    priceCurrency: price?.currency ?? null,
    discountPercent: price?.discount_percent || null,
    reviewPercent: hasReviews ? Math.round((positive / total) * 100) : null,
    // Without the review endpoint, fall back to the store's recommendation count.
    reviewCount: hasReviews ? total : (d.recommendations?.total ?? null),
    reviewLabel: hasReviews ? reviews.review_score_desc || null : null,
    metacritic: d.metacritic?.score ?? null,
  };
}

async function getJson(url: string, cfg: SteamStoreConfig): Promise<unknown | null> {
  try {
    const res = await (cfg.fetchImpl ?? fetch)(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Review summary; null when Steam doesn't answer (it sometimes redirects servers away). */
export async function fetchSteamReviews(
  appId: string,
  cfg: SteamStoreConfig,
): Promise<RawReviewSummary | null> {
  const url = `${cfg.baseUrl}/appreviews/${appId}?json=1&language=all&purchase_type=all&num_per_page=0&l=${LANG}`;
  const data = (await getJson(url, cfg)) as { success?: number; query_summary?: RawReviewSummary };
  return data?.success === 1 && data.query_summary ? data.query_summary : null;
}

export async function fetchSteamApp(appId: string, cfg: SteamStoreConfig): Promise<SteamAppResult> {
  const url = `${cfg.baseUrl}/api/appdetails?appids=${appId}&l=${LANG}&cc=${cfg.country}`;
  const [data, reviews] = await Promise.all([
    getJson(url, cfg) as Promise<Record<
      string,
      { success?: boolean; data?: RawAppDetails }
    > | null>,
    fetchSteamReviews(appId, cfg),
  ]);
  if (!data) return { ok: false, reason: "unavailable" };
  const entry = data[appId];
  if (!entry?.success || !entry.data) return { ok: false, reason: "not-found" };
  if (entry.data.type !== "game") return { ok: false, reason: "not-a-game" };
  return { ok: true, game: mapAppDetails(appId, entry.data, reviews) };
}

type RawSearchItem = {
  type?: string;
  id?: number;
  name?: string;
  tiny_image?: string;
  price?: { currency: string; final: number };
};

export function mapSearchResults(items: RawSearchItem[]): SteamSearchResult[] {
  return items
    .filter((i) => i.type === "app" && typeof i.id === "number" && i.name)
    .map((i) => ({
      appId: String(i.id),
      name: i.name!,
      imageUrl: i.tiny_image || null,
      priceFinal: i.price?.final ?? null,
      priceCurrency: i.price?.currency ?? null,
    }));
}

/** Store search. Null when Steam is unreachable. */
export async function searchSteam(
  term: string,
  cfg: SteamStoreConfig,
): Promise<SteamSearchResult[] | null> {
  const url = `${cfg.baseUrl}/api/storesearch/?term=${encodeURIComponent(term)}&l=${LANG}&cc=${cfg.country}`;
  const data = (await getJson(url, cfg)) as { items?: RawSearchItem[] } | null;
  return data ? mapSearchResults(data.items ?? []) : null;
}
