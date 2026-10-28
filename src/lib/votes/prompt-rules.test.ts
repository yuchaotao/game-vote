import { describe, expect, it } from "vitest";
import { playersNeeded, promptCandidates } from "./prompt-rules";

const MIN = 60_000;
const now = Date.UTC(2026, 9, 28, 21);
/** Someone playing `gameId` from `fromMin` minutes ago until now (or `toMin` ago). */
const play = (userId: string, gameId: string, fromMin: number, toMin = 0) => ({
  userId,
  gameId,
  start: now - fromMin * MIN,
  end: now - toMin * MIN,
});
const standings = (...ranked: [string, number][]) =>
  ranked.map(([gameId, rank]) => ({ gameId, rank, votes: 3 - rank, voterIds: [] }));

const base = {
  memberCount: 4,
  standings: standings(["apex", 1], ["bg3", 2], ["cs2", 3]),
  prompts: [],
  now,
};

describe("playersNeeded", () => {
  it("is more than half, and at least two", () => {
    expect([1, 2, 3, 4, 5, 6].map(playersNeeded)).toEqual([2, 2, 2, 3, 3, 4]);
  });
});

describe("promptCandidates", () => {
  it("prompts when more than half play a top-2 game together for over 20 minutes", () => {
    const intervals = [play("a", "bg3", 30), play("b", "bg3", 25), play("c", "bg3", 22)];
    expect(promptCandidates({ ...base, intervals })).toEqual([
      { gameId: "bg3", players: 3, playingSince: new Date(now - 22 * MIN), rank: 2 },
    ]);
  });

  it("needs more than half (3 of 4), not just half", () => {
    const intervals = [play("a", "apex", 60), play("b", "apex", 60)];
    expect(promptCandidates({ ...base, intervals })).toEqual([]);
  });

  it("needs over 20 minutes together", () => {
    const intervals = [play("a", "apex", 60), play("b", "apex", 60), play("c", "apex", 19)];
    expect(promptCandidates({ ...base, intervals })).toEqual([]);
  });

  it("needs the game to rank top 2, and to be a candidate at all", () => {
    const cs2 = [play("a", "cs2", 60), play("b", "cs2", 60), play("c", "cs2", 60)];
    expect(promptCandidates({ ...base, intervals: cs2 })).toEqual([]);
    const other = cs2.map((i) => ({ ...i, gameId: "dota" }));
    expect(promptCandidates({ ...base, intervals: other })).toEqual([]);
  });

  it("needs them to be playing now, not earlier today", () => {
    const intervals = [
      play("a", "apex", 120, 30),
      play("b", "apex", 120, 30),
      play("c", "apex", 120, 30),
    ];
    expect(promptCandidates({ ...base, intervals })).toEqual([]);
  });

  it("prompts once per session: not while pending, not again for the same session", () => {
    const intervals = [play("a", "apex", 40), play("b", "apex", 40), play("c", "apex", 40)];
    const since = new Date(now - 40 * MIN);
    const pending = [{ gameId: "bg3", playingSince: since, status: "PENDING" }];
    expect(promptCandidates({ ...base, intervals, prompts: pending })).toEqual([]);
    const continued = [{ gameId: "apex", playingSince: since, status: "CONTINUED" }];
    expect(promptCandidates({ ...base, intervals, prompts: continued })).toEqual([]);
  });

  it("prompts again after 'continue' for a new play session", () => {
    const earlier = new Date(now - 300 * MIN);
    const intervals = [play("a", "apex", 40), play("b", "apex", 40), play("c", "apex", 40)];
    const continued = [{ gameId: "apex", playingSince: earlier, status: "CONTINUED" }];
    expect(promptCandidates({ ...base, intervals, prompts: continued })).toHaveLength(1);
  });

  it("small groups: 2 of 2 or 2 of 3; never a lone player", () => {
    const two = [play("a", "apex", 30), play("b", "apex", 30)];
    expect(promptCandidates({ ...base, memberCount: 2, intervals: two })).toHaveLength(1);
    expect(promptCandidates({ ...base, memberCount: 3, intervals: two })).toHaveLength(1);
    expect(
      promptCandidates({ ...base, memberCount: 1, intervals: [play("a", "apex", 60)] }),
    ).toEqual([]);
  });

  it("picks the better-ranked game when two qualify", () => {
    const intervals = [
      ...["a", "b", "c"].map((u) => play(u, "bg3", 30)),
      ...["d", "e", "f"].map((u) => play(u, "apex", 30)),
    ];
    const [p] = promptCandidates({ ...base, memberCount: 6, intervals });
    expect(p).toBeUndefined(); // 3 of 6 is not more than half
    const [q] = promptCandidates({ ...base, memberCount: 5, intervals });
    expect(q.gameId).toBe("apex");
  });
});
