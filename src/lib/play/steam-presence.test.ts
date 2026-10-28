import { describe, expect, it, vi } from "vitest";
import { getSteamPresence, mapPlayer } from "./steam-presence";

describe("mapPlayer", () => {
  it("reads the game being played", () => {
    expect(
      mapPlayer({
        steamid: "1",
        personastate: 1,
        communityvisibilitystate: 3,
        gameid: "1172470",
        gameextrainfo: "Apex Legends",
        personaname: " Tao ",
        avatarfull: "https://avatars/a.jpg",
      }),
    ).toEqual({
      steamId: "1",
      personaState: 1,
      visibility: 3,
      appId: "1172470",
      gameName: "Apex Legends",
      personaName: "Tao",
      avatarUrl: "https://avatars/a.jpg",
    });
  });

  it("ignores non-Steam shortcuts and handles private profiles", () => {
    expect(
      mapPlayer({ steamid: "1", gameid: "12345678901234567890", gameextrainfo: "X" }),
    ).toMatchObject({
      appId: null,
      gameName: null,
      personaState: 0,
      visibility: 1,
    });
  });
});

describe("getSteamPresence", () => {
  const players = (ids: string[]) => ids.map((steamid) => ({ steamid, personastate: 1 }));

  it("batches 100 ids per request", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const ids = new URL(String(url)).searchParams.get("steamids")!.split(",");
      return new Response(JSON.stringify({ response: { players: players(ids) } }));
    }) as unknown as typeof fetch;
    const ids = Array.from({ length: 150 }, (_, i) => String(i));
    const result = await getSteamPresence(ids, { apiKey: "k", baseUrl: "https://api", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(150);
  });

  it("returns null when any batch fails", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () =>
      ++call === 2
        ? new Response("", { status: 429 })
        : new Response(JSON.stringify({ response: { players: [] } })),
    ) as unknown as typeof fetch;
    const ids = Array.from({ length: 150 }, (_, i) => String(i));
    expect(
      await getSteamPresence(ids, { apiKey: "k", baseUrl: "https://api", fetchImpl }),
    ).toBeNull();
  });
});
