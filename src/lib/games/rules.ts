import { z } from "zod";

export const MAX_GAME_NAME = 100;

/** Splits "射击, 多人，FPS" into ["射击", "多人", "FPS"] (ASCII or full-width commas, 、). */
export function splitList(raw: string, max = 10): string[] {
  const items = raw
    .split(/[,，、\n]/)
    .map((s) => s.trim().slice(0, 30))
    .filter(Boolean);
  return [...new Set(items)].slice(0, max);
}

const optionalUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(500, `${label}太长`)
    .refine(
      (v) => v === "" || /^https?:\/\/\S+$/i.test(v),
      `${label}需要以 http:// 或 https:// 开头`,
    )
    .transform((v) => v || null);

/** A game typed in by hand (Battlefield, Battle.net titles, anything not on Steam). */
export const manualGameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请填写游戏名")
    .max(MAX_GAME_NAME, `游戏名最多 ${MAX_GAME_NAME} 字`),
  platforms: z
    .string()
    .max(200)
    .transform((v) => splitList(v)),
  genres: z
    .string()
    .max(200)
    .transform((v) => splitList(v)),
  features: z
    .string()
    .max(200)
    .transform((v) => splitList(v)),
  description: z.string().trim().max(2000, "简介最多 2000 字"),
  coverUrl: optionalUrl("封面图片地址").refine(
    (v) => v === null || v.startsWith("https://"),
    "封面图片地址需要以 https:// 开头",
  ),
  storeUrl: optionalUrl("商店 / 官网链接"),
});

export type ManualGameInput = z.infer<typeof manualGameSchema>;

/** Library entries are removed / edited by whoever added them, or the group owner. */
export function canManageGroupGame(
  userId: string,
  entry: { addedById: string | null },
  ownerId: string,
): boolean {
  return userId === ownerId || entry.addedById === userId;
}

/** Formats a price in the currency's smallest unit, e.g. 2999 USD → "US$29.99". */
export function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency}`;
  }
}

export type LibrarySort = "hot" | "recent" | "rating" | "name";

type Sortable = {
  name: string;
  addedAt: Date | string;
  reviewPercent: number | null;
  metacritic: number | null;
  /** Hot score (see hotness.ts); 0 when unknown. */
  hot?: number;
};

/** Rating used for sorting: Steam positive share, else Metacritic. */
export function ratingOf(g: Pick<Sortable, "reviewPercent" | "metacritic">): number | null {
  return g.reviewPercent ?? g.metacritic ?? null;
}

export function sortLibrary<T extends Sortable>(games: T[], sort: LibrarySort): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, "zh-CN");
  const sorted = [...games];
  if (sort === "name") return sorted.sort(byName);
  const byRating = (a: T, b: T) => (ratingOf(b) ?? -1) - (ratingOf(a) ?? -1);
  if (sort === "rating") return sorted.sort((a, b) => byRating(a, b) || byName(a, b));
  if (sort === "hot") {
    return sorted.sort((a, b) => (b.hot ?? 0) - (a.hot ?? 0) || byRating(a, b) || byName(a, b));
  }
  return sorted.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
}

/** Whether a game can be played together (any play mode besides single player). */
export function isMultiplayer(features: string[]): boolean {
  return features.some((f) => f !== "单人" && f !== "Single player");
}

/** Case- and width-insensitive name match for the library filter and duplicate check. */
export function normalizeGameName(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}
