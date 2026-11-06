import { msg } from "@/lib/i18n";

// Gambling in anonymous rounds (#57): 赌一把 (a chance to peek) and 偷梁换柱 (a chance
// to switch someone's vote). Pure: shared by the server and the coin icon.

/** Each member's lucky coin per group: their chance of winning, in percent. */
export const LUCK = { start: 50, win: 5, lose: -1, min: 10, max: 90 } as const;

export function nextLuck(luck: number, won: boolean): number {
  return Math.min(LUCK.max, Math.max(LUCK.min, luck + (won ? LUCK.win : LUCK.lose)));
}

/** `roll` is a uniform integer 0–99. */
export const wins = (luck: number, roll: number) => roll < luck;

export type CoinTier = "rusty" | "copper" | "silver" | "gold" | "shining" | "rainbow";

export const COIN_LABEL: Record<CoinTier, string> = {
  rusty: msg("生锈的铜币"),
  copper: msg("铜币"),
  silver: msg("银币"),
  gold: msg("金币"),
  shining: msg("闪耀金币"),
  rainbow: msg("彩虹幸运币"),
};

export function coinTier(luck: number): CoinTier {
  if (luck >= 90) return "rainbow";
  if (luck >= 80) return "shining";
  if (luck >= 70) return "gold";
  if (luck >= 60) return "silver";
  if (luck >= 46) return "copper";
  return "rusty";
}

export type Ballot = { userId: string; gameId: string; count: number };
export type Swap = { victimId: string; fromGameId: string; toGameId: string };

/**
 * Every possible 偷梁换柱: one of another member's votes (on `fromGameId`) becomes
 * a vote for a game `me` voted for. Pointless moves (same game) are out, and so
 * is giving someone a second vote on a game when the round allows only one.
 */
export function swapOptions(me: string, ballots: Ballot[], repeat: boolean): Swap[] {
  const live = ballots.filter((b) => b.count > 0);
  const mine = [...new Set(live.filter((b) => b.userId === me).map((b) => b.gameId))];
  const has = (userId: string, gameId: string) =>
    live.some((b) => b.userId === userId && b.gameId === gameId);
  const out: Swap[] = [];
  for (const b of live) {
    if (b.userId === me) continue;
    for (const to of mine) {
      if (to === b.gameId || (!repeat && has(b.userId, to))) continue;
      out.push({ victimId: b.userId, fromGameId: b.gameId, toGameId: to });
    }
  }
  return out;
}
