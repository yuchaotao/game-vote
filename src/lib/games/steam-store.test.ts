import { describe, expect, it, vi } from "vitest";
import {
  fetchSteamApp,
  mapAppDetails,
  mapSearchResults,
  parseSteamAppId,
  searchSteam,
} from "./steam-store";

describe("parseSteamAppId", () => {
  it.each([
    ["https://store.steampowered.com/app/1086940/Baldurs_Gate_3/", "1086940"],
    ["store.steampowered.com/app/1172470", "1172470"],
    ["https://store.steampowered.com/agecheck/app/1091500/", "1091500"],
    ["https://steamcommunity.com/app/730/reviews/", "730"],
    ["https://s.team/a/570", "570"],
    ["https://steamdb.info/app/440/charts/", "440"],
    ["steam://run/730", "730"],
    ["  1086940 ", "1086940"],
  ])("%s → %s", (input, expected) => {
    expect(parseSteamAppId(input)).toBe(expected);
  });

  it.each([
    "apex legends",
    "博德之门3",
    "https://store.steampowered.com/search/?term=apex",
    "https://example.com/app/123",
    "https://store.steampowered.com.evil.com/app/123",
    "12345678901",
    "",
  ])("rejects %s", (input) => {
    expect(parseSteamAppId(input)).toBeNull();
  });
});

const details = {
  type: "game",
  name: "Apex Legends™",
  is_free: true,
  short_description: " 免费大逃杀。 ",
  header_image: "https://cdn/header.jpg",
  developers: ["Respawn", "Respawn"],
  genres: [
    { id: "1", description: "动作" },
    { id: "37", description: "免费开玩" },
  ],
  categories: [
    { id: 22, description: "Steam 成就" },
    { id: 9, description: "合作" },
    { id: 1, description: "多人" },
  ],
  platforms: { windows: true, mac: true, linux: false },
  release_date: { date: "2020 年 11 月 4 日" },
  metacritic: { score: 88 },
  recommendations: { total: 1234 },
  screenshots: Array.from({ length: 8 }, (_, i) => ({ path_thumbnail: `https://cdn/s${i}.jpg` })),
};

describe("mapAppDetails", () => {
  it("keeps co-op / multiplayer categories in display order and drops the rest", () => {
    const g = mapAppDetails("1172470", details, null);
    expect(g.features).toEqual(["多人", "合作"]);
    expect(g.genres).toEqual(["动作", "免费开玩"]);
    expect(g.platforms).toEqual(["Windows", "macOS"]);
    expect(g.developers).toEqual(["Respawn"]);
    expect(g.description).toBe("免费大逃杀。");
    expect(g.screenshots).toHaveLength(6);
    expect(g.storeUrl).toBe("https://store.steampowered.com/app/1172470/");
    expect(g.isFree).toBe(true);
    expect(g.priceFinal).toBeNull();
  });

  it("uses the review summary when available", () => {
    const g = mapAppDetails("1", details, {
      review_score_desc: "特别好评",
      total_positive: 873,
      total_negative: 127,
      total_reviews: 1000,
    });
    expect(g).toMatchObject({ reviewPercent: 87, reviewCount: 1000, reviewLabel: "特别好评" });
  });

  it("falls back to the recommendation count without reviews", () => {
    const g = mapAppDetails("1", details, null);
    expect(g).toMatchObject({ reviewPercent: null, reviewCount: 1234, reviewLabel: null });
    expect(mapAppDetails("1", details, { total_reviews: 0 }).reviewPercent).toBeNull();
  });

  it("maps prices and ignores a zero discount", () => {
    const paid = {
      ...details,
      is_free: false,
      price_overview: { currency: "USD", initial: 5999, final: 5999, discount_percent: 0 },
    };
    expect(mapAppDetails("1", paid, null)).toMatchObject({
      priceFinal: 5999,
      priceInitial: 5999,
      priceCurrency: "USD",
      discountPercent: null,
    });
  });
});

const cfg = (fetchImpl: typeof fetch) => ({ baseUrl: "https://store", country: "us", fetchImpl });
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("fetchSteamApp", () => {
  it("combines app details with the review summary", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("appreviews")
        ? ok({ success: 1, query_summary: { total_positive: 9, total_reviews: 10 } })
        : ok({ "42": { success: true, data: details } }),
    ) as unknown as typeof fetch;
    const res = await fetchSteamApp("42", cfg(fetchImpl));
    expect(res.ok && res.game.reviewPercent).toBe(90);
  });

  it("still works when the review endpoint redirects", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("appreviews")
        ? new Response(null, { status: 302 })
        : ok({ "42": { success: true, data: details } }),
    ) as unknown as typeof fetch;
    const res = await fetchSteamApp("42", cfg(fetchImpl));
    expect(res.ok && res.game.reviewCount).toBe(1234);
  });

  it("reports unknown apps, non-games and outages", async () => {
    const answer = (body: unknown) => vi.fn(async () => ok(body)) as unknown as typeof fetch;
    expect(await fetchSteamApp("42", cfg(answer({ "42": { success: false } })))).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(
      await fetchSteamApp("42", cfg(answer({ "42": { success: true, data: { type: "dlc" } } }))),
    ).toEqual({ ok: false, reason: "not-a-game" });
    const down = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await fetchSteamApp("42", cfg(down))).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("search", () => {
  it("keeps apps only", () => {
    expect(
      mapSearchResults([
        { type: "app", id: 1, name: "A", tiny_image: "i", price: { currency: "USD", final: 999 } },
        { type: "sub", id: 2, name: "Bundle" },
        { type: "app", id: 3, name: "B" },
      ]),
    ).toEqual([
      { appId: "1", name: "A", imageUrl: "i", priceFinal: 999, priceCurrency: "USD" },
      { appId: "3", name: "B", imageUrl: null, priceFinal: null, priceCurrency: null },
    ]);
  });

  it("returns null when Steam is down", async () => {
    const down = vi.fn(async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    expect(await searchSteam("apex", cfg(down))).toBeNull();
  });
});
