import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyDiscordSignature } from "@/lib/notify/discord-bot";
import {
  MAX_VOTE_BUTTONS,
  parseButtonId,
  renderPrompt,
  renderRound,
  type RoundView,
} from "./discord-render";

const base: RoundView = {
  id: "r1",
  groupName: "周末开黑",
  label: "第 2 轮投票",
  url: "https://x.test/groups/g/votes/r1",
  open: true,
  maxVotes: 3,
  deadline: null,
  candidates: [
    { gameId: "a", name: "Apex", votes: 1 },
    { gameId: "b", name: "博德之门3", votes: 3 },
  ],
  ranked: [
    { gameId: "b", name: "博德之门3", votes: 3, rank: 1 },
    { gameId: "a", name: "Apex", votes: 1, rank: 2 },
  ],
  voters: 3,
  winner: null,
};

describe("renderRound", () => {
  it("open: standings, one button per candidate in added order, and a link row", () => {
    const m = renderRound(base, ["42"]);
    expect(m.content).toBe("<@42>");
    expect(m.allowed_mentions).toEqual({ users: ["42"] });
    expect(m.embeds[0].description).toContain("**1.** 博德之门3");
    const [votes, linkRow] = m.components;
    expect(votes.components.map((b) => [b.label, b.custom_id])).toEqual([
      ["Apex · 1", "vote:r1:a"],
      ["博德之门3 · 3", "vote:r1:b"],
    ]);
    expect(linkRow.components[0]).toMatchObject({ style: 5, url: base.url });
  });

  it("deadline uses a Discord timestamp; edits don't ping anyone", () => {
    const m = renderRound({ ...base, deadline: new Date("2026-11-01T12:00:00Z") });
    expect(m.embeds[0].description).toContain("<t:1793534400:R>");
    expect(m).not.toHaveProperty("content");
    expect(m.allowed_mentions).toEqual({ users: [] });
  });

  it("caps vote buttons and says so", () => {
    const many = Array.from({ length: 23 }, (_, i) => ({
      gameId: `g${i}`,
      name: `G${i}`,
      votes: 0,
    }));
    const m = renderRound({
      ...base,
      candidates: many,
      ranked: many.map((c) => ({ ...c, rank: 1 })),
    });
    const buttons = m.components.slice(0, -1).flatMap((r) => r.components);
    expect(buttons).toHaveLength(MAX_VOTE_BUTTONS);
    expect(m.components).toHaveLength(5);
    expect(m.embeds[0].description).toContain("其余的请在网站上投票");
  });

  it("ended: winner, no vote buttons", () => {
    const m = renderRound({ ...base, open: false, winner: "博德之门3" });
    expect(m.embeds[0].title).toContain("已结束");
    expect(m.embeds[0].description).toContain("🏆 胜出：**博德之门3**");
    expect(m.components).toHaveLength(1);
  });
});

describe("renderPrompt", () => {
  const p = { id: "p1", title: "t", body: "b", url: "https://x.test", outcome: null };
  it("three choices while unanswered, none after", () => {
    expect(renderPrompt(p).components[0].components.map((b) => b.custom_id)).toEqual([
      "prompt:p1:next",
      "prompt:p1:continue",
      "prompt:p1:end",
    ]);
    const done = renderPrompt({ ...p, outcome: "小明 选择继续当前投票" });
    expect(done.components).toEqual([]);
    expect(done.embeds[0].description).toContain("小明 选择继续当前投票");
  });
});

describe("parseButtonId", () => {
  it("accepts our ids only", () => {
    expect(parseButtonId("vote:r1:g1")).toEqual({ kind: "vote", id: "r1", arg: "g1" });
    expect(parseButtonId("prompt:p1:next")).toEqual({ kind: "prompt", id: "p1", arg: "next" });
    expect(parseButtonId("other:x:y")).toBeNull();
    expect(parseButtonId("vote:r1")).toBeNull();
  });
});

describe("verifyDiscordSignature", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const hex = publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
  const body = '{"type":1}';
  const ts = "1700000000";
  const sig = sign(null, Buffer.from(ts + body), privateKey).toString("hex");

  it("accepts Discord's signature and rejects anything else", () => {
    expect(verifyDiscordSignature(hex, sig, ts, body)).toBe(true);
    expect(verifyDiscordSignature(hex, sig, ts, '{"type":2}')).toBe(false);
    expect(verifyDiscordSignature(hex, "00".repeat(64), ts, body)).toBe(false);
    expect(verifyDiscordSignature(hex, "not-hex", ts, body)).toBe(false);
  });
});
