// Minimal stand-in for the Steam store / Web API and IGDB endpoints the app uses, so e2e tests
// don't depend on (or hammer) the real store. Started by playwright.config.ts.
import { createServer } from "node:http";

const PORT = Number(process.env.STEAM_MOCK_PORT ?? 4100);
const base = `http://localhost:${PORT}`;
const img = (name) => `${base}/img/${name}.svg`;

const apps = {
  // Free multiplayer game; the review endpoint "redirects" like it does for some servers.
  1172470: {
    type: "game",
    name: "Apex Legends™",
    is_free: true,
    short_description: "免费大逃杀英雄射击游戏。",
    header_image: img("apex"),
    developers: ["Respawn"],
    genres: [
      { id: "1", description: "动作" },
      { id: "37", description: "免费开玩" },
    ],
    categories: [
      { id: 1, description: "多人" },
      { id: 36, description: "线上玩家对战" },
      { id: 9, description: "合作" },
      { id: 22, description: "Steam 成就" },
    ],
    platforms: { windows: true, mac: false, linux: false },
    release_date: { date: "2020 年 11 月 4 日" },
    metacritic: { score: 88 },
    recommendations: { total: 312345 },
    screenshots: [{ path_thumbnail: img("apex-1") }, { path_thumbnail: img("apex-2") }],
  },
  // Paid game on sale, with a working review summary.
  1086940: {
    type: "game",
    name: "博德之门3",
    is_free: false,
    short_description: "召集你的队伍，回到被遗忘的国度。",
    header_image: img("bg3"),
    developers: ["Larian Studios"],
    genres: [{ id: "3", description: "角色扮演" }],
    categories: [
      { id: 2, description: "单人" },
      { id: 1, description: "多人" },
      { id: 38, description: "在线合作" },
    ],
    platforms: { windows: true, mac: true, linux: false },
    price_overview: { currency: "USD", initial: 5999, final: 4799, discount_percent: 20 },
    release_date: { date: "2023 年 8 月 3 日" },
    metacritic: { score: 96 },
    screenshots: [{ path_thumbnail: img("bg3-1") }],
  },
  // A soundtrack: rejected as "not a game".
  2000: { type: "music", name: "Some Soundtrack" },
};

// IGDB games: one only on EA / consoles, one that IGDB knows is on Steam.
const igdbGames = [
  {
    id: 1001,
    name: "Battlefield 4",
    summary: "All-out war on land, sea and air.",
    first_release_date: 1383004800,
    cover: { image_id: "bf4cover" },
    artworks: [{ image_id: "bf4art" }],
    screenshots: [{ image_id: "bf4shot" }],
    genres: [{ name: "Shooter" }],
    game_modes: [{ name: "Single player" }, { name: "Multiplayer" }],
    platforms: [{ abbreviation: "PC", name: "PC (Microsoft Windows)" }, { abbreviation: "PS4" }],
    involved_companies: [{ developer: true, company: { name: "DICE" } }],
    websites: [{ type: 1, url: "https://www.ea.com/games/battlefield/battlefield-4" }],
    total_rating: 78.04,
    total_rating_count: 412,
    url: "https://www.igdb.com/games/battlefield-4",
  },
  {
    id: 1002,
    name: "Battlefield Apex Crossover",
    first_release_date: 1604448000,
    platforms: [{ abbreviation: "PC" }],
    external_games: [{ external_game_source: 1, uid: "1172470" }],
  },
];

// Steam Web API player status, set by tests through POST /mock/players.
const players = {};

// Discord DMs sent by the bot, per recipient id; read through GET /mock/discord/messages.
const discordDms = {};

const reviews = {
  1086940: {
    review_score_desc: "好评如潮",
    total_positive: 960,
    total_negative: 40,
    total_reviews: 1000,
  },
};

function json(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url, base);
  const path = url.pathname;

  if (path === "/health") return json(res, { ok: true });

  // Discord REST API (bot DMs). Recipient ids starting with 999 have DMs closed.
  if (path.startsWith("/discord/api/") && req.method === "POST") {
    if (req.headers.authorization !== "Bot e2e-bot-token")
      return json(res, { message: "401: Unauthorized", code: 0 }, 401);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const data = JSON.parse(body || "{}");
      if (path === "/discord/api/users/@me/channels") {
        if (data.recipient_id.startsWith("999"))
          return json(res, { message: "Cannot send messages to this user", code: 50007 }, 403);
        return json(res, { id: `dm-${data.recipient_id}` });
      }
      const dm = /^\/discord\/api\/channels\/dm-(\w+)\/messages$/.exec(path);
      if (!dm) return json(res, { message: "Unknown", code: 0 }, 404);
      (discordDms[dm[1]] ??= []).push(data);
      json(res, { id: `msg-${Date.now()}` });
    });
    return;
  }
  if (path === "/mock/discord/messages") {
    return json(res, discordDms[url.searchParams.get("recipient")] ?? []);
  }

  // IGDB / Twitch. Token: POST /igdb/token; queries: POST /igdb/v4/games.
  if (path === "/igdb/token" && req.method === "POST") {
    return json(res, {
      access_token: "mock-igdb-token",
      expires_in: 5000000,
      token_type: "bearer",
    });
  }

  if (path === "/igdb/v4/games" && req.method === "POST") {
    if (req.headers.authorization !== "Bearer mock-igdb-token")
      return json(res, { message: "unauthorized" }, 401);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const search = /search "([^"]*)"/.exec(body)?.[1]?.toLowerCase();
      const id = /where id = (\d+)/.exec(body)?.[1];
      const found = igdbGames.filter((g) =>
        id ? String(g.id) === id : search ? g.name.toLowerCase().includes(search) : false,
      );
      json(res, found);
    });
    return;
  }

  // Steam Web API presence. Tests set a player's status with
  // POST /mock/players {"<steamid>": {gameid, gameextrainfo, personastate, communityvisibilitystate}}.
  if (path === "/mock/players" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      Object.assign(players, JSON.parse(body || "{}"));
      json(res, { ok: true });
    });
    return;
  }

  if (path === "/ISteamUser/GetPlayerSummaries/v2/") {
    const ids = (url.searchParams.get("steamids") ?? "").split(",").filter(Boolean);
    return json(res, {
      response: {
        players: ids.map((steamid) => ({
          steamid,
          personastate: 0,
          communityvisibilitystate: 3,
          ...players[steamid],
        })),
      },
    });
  }

  if (path === "/api/appdetails") {
    const id = url.searchParams.get("appids");
    const app = apps[id];
    return json(res, {
      [id]: app ? { success: true, data: { steam_appid: Number(id), ...app } } : { success: false },
    });
  }

  const review = /^\/appreviews\/(\d+)$/.exec(path);
  if (review) {
    const summary = reviews[review[1]];
    if (!summary) {
      res.writeHead(302, { location: "https://store.steampowered.com/" });
      return res.end();
    }
    return json(res, { success: 1, query_summary: summary });
  }

  if (path === "/api/storesearch/") {
    const term = (url.searchParams.get("term") ?? "").toLowerCase();
    const items = Object.entries(apps)
      .filter(([, a]) => a.type === "game")
      .filter(
        ([id, a]) =>
          a.name.toLowerCase().includes(term) ||
          (term === "apex" && id === "1172470") ||
          (term === "baldur" && id === "1086940"),
      )
      .map(([id, a]) => ({
        type: "app",
        id: Number(id),
        name: a.name,
        tiny_image: a.header_image,
        ...(a.price_overview && {
          price: {
            currency: a.price_overview.currency,
            initial: a.price_overview.initial,
            final: a.price_overview.final,
          },
        }),
      }));
    return json(res, { total: items.length, items });
  }

  if (path.startsWith("/img/")) {
    const label = path.slice(5).replace(/\.svg$/, "");
    res.writeHead(200, { "content-type": "image/svg+xml" });
    return res.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215"><rect width="100%" height="100%" fill="#334155"/><text x="20" y="120" fill="#fff" font-size="40">${label}</text></svg>`,
    );
  }

  res.writeHead(404);
  res.end();
}).listen(PORT, () => console.log(`[steam-mock] listening on ${base}`));
