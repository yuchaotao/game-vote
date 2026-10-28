// Minimal stand-in for the Steam store endpoints the app uses, so e2e tests
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

// Steam Web API player status, set by tests through POST /mock/players.
const players = {};

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
