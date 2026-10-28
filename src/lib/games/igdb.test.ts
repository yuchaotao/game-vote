import { describe, expect, it, vi } from "vitest";
import {
  fetchIgdbGame,
  igdbSearchQuery,
  mapGameDetails,
  mapSearchResult,
  requestIgdbToken,
  searchIgdb,
} from "./igdb";

const bf4 = {
  id: 1001,
  name: "Battlefield 4",
  summary: " All-out war. ",
  first_release_date: 1383004800, // 2013-10-29
  cover: { image_id: "cov" },
  artworks: [{ image_id: "art" }],
  screenshots: [{ image_id: "s1" }, { image_id: "s2" }],
  genres: [{ name: "Shooter" }, { name: "Some New Genre" }],
  game_modes: [{ name: "Single player" }, { name: "Multiplayer" }, { name: "Co-operative" }],
  platforms: [
    { abbreviation: "PC", name: "PC (Microsoft Windows)" },
    { abbreviation: "PS4" },
    { name: "Google Stadia" },
  ],
  involved_companies: [
    { developer: true, company: { name: "DICE" } },
    { developer: false, company: { name: "EA" } },
  ],
  websites: [
    { type: 4, url: "https://facebook.com/battlefield" },
    { type: 1, url: "https://www.ea.com/games/battlefield/battlefield-4" },
  ],
  total_rating: 78.04,
  total_rating_count: 412,
  url: "https://www.igdb.com/games/battlefield-4",
};

describe("mapGameDetails", () => {
  it("maps to our fields with Chinese genres and play modes", () => {
    expect(mapGameDetails(bf4)).toEqual({
      externalId: "1001",
      name: "Battlefield 4",
      coverUrl: "https://images.igdb.com/igdb/image/upload/t_720p/art.jpg",
      description: "All-out war.",
      genres: ["射击", "Some New Genre"],
      features: ["多人", "合作", "单人"],
      platforms: ["PC", "PS4", "Google Stadia"],
      developers: ["DICE"],
      releaseDate: "2013-10-29",
      screenshots: [
        "https://images.igdb.com/igdb/image/upload/t_screenshot_med/s1.jpg",
        "https://images.igdb.com/igdb/image/upload/t_screenshot_med/s2.jpg",
      ],
      storeUrl: "https://www.ea.com/games/battlefield/battlefield-4",
      reviewPercent: 78,
      reviewCount: 412,
      reviewLabel: "IGDB 评分",
    });
  });

  it("falls back to the portrait cover and the IGDB page, and handles no rating", () => {
    const g = mapGameDetails({ id: 7, cover: { image_id: "c" }, url: "https://igdb/x" });
    expect(g).toMatchObject({
      name: "IGDB 7",
      coverUrl: "https://images.igdb.com/igdb/image/upload/t_cover_big/c.jpg",
      storeUrl: "https://igdb/x",
      reviewPercent: null,
      reviewLabel: null,
    });
  });
});

describe("mapSearchResult", () => {
  it("finds the Steam appid from external games or the Steam website", () => {
    expect(
      mapSearchResult({ id: 1, external_games: [{ external_game_source: 1, uid: "1172470" }] })
        .steamAppId,
    ).toBe("1172470");
    expect(
      mapSearchResult({
        id: 2,
        websites: [{ type: 13, url: "https://store.steampowered.com/app/681350" }],
      }).steamAppId,
    ).toBe("681350");
    // GOG / Xbox ids aren't Steam.
    expect(
      mapSearchResult({ id: 3, external_games: [{ external_game_source: 5, uid: "123" }] })
        .steamAppId,
    ).toBeNull();
  });

  it("summarises for the result list", () => {
    expect(mapSearchResult(bf4)).toEqual({
      igdbId: "1001",
      name: "Battlefield 4",
      imageUrl: "https://images.igdb.com/igdb/image/upload/t_thumb/cov.jpg",
      year: 2013,
      platforms: ["PC", "PS4", "Google Stadia"],
      steamAppId: null,
    });
  });
});

describe("queries", () => {
  it("escapes the search term and keeps to main games", () => {
    const q = igdbSearchQuery('bf "4"\\ ', "name", 10);
    expect(q).toBe(
      'search "bf 4"; fields name; where game_type = (0,4,8,9,10,11) & version_parent = null; limit 10;',
    );
  });

  const cfg = (fetchImpl: typeof fetch) => ({
    clientId: "id",
    token: async () => "tok",
    baseUrl: "https://igdb",
    fetchImpl,
  });

  it("sends auth headers and maps results", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify([bf4])),
    ) as unknown as typeof fetch;
    expect((await searchIgdb("bf", cfg(fetchImpl)))?.[0].name).toBe("Battlefield 4");
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://igdb/games");
    expect(init.headers).toEqual({ "Client-ID": "id", Authorization: "Bearer tok" });
  });

  it("reports missing games and outages", async () => {
    const empty = vi.fn(async () => new Response("[]")) as unknown as typeof fetch;
    expect(await fetchIgdbGame("5", cfg(empty))).toEqual({ ok: false, reason: "not-found" });
    const down = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    expect(await fetchIgdbGame("5", cfg(down))).toEqual({ ok: false, reason: "unavailable" });
    expect(await searchIgdb("x", { ...cfg(down), token: async () => null })).toBeNull();
  });

  it("requests a client-credentials token", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ access_token: "t", expires_in: 5000 })),
    ) as unknown as typeof fetch;
    expect(await requestIgdbToken("id", "secret", "https://id/token", fetchImpl)).toEqual({
      token: "t",
      expiresIn: 5000,
    });
    const body = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body;
    expect(String(body)).toBe("client_id=id&client_secret=secret&grant_type=client_credentials");
  });
});
