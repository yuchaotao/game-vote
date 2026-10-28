import { describe, expect, it } from "vitest";
import { clip, formatDuration, planSteamUpdates, playTotals, togetherSegments } from "./rules";

const MIN = 60_000;

describe("planSteamUpdates", () => {
  it("keeps, switches, stops and starts", () => {
    const plan = planSteamUpdates(
      [
        { id: "s-keep", userId: "a", appId: "730" },
        { id: "s-switch", userId: "b", appId: "730" },
        { id: "s-stop", userId: "c", appId: "730" },
      ],
      [
        { userId: "a", appId: "730", gameName: "CS2" },
        { userId: "b", appId: "570", gameName: "Dota 2" },
        { userId: "c", appId: null, gameName: null },
        { userId: "d", appId: "440", gameName: "TF2" },
        { userId: "e", appId: null, gameName: null },
      ],
    );
    expect(plan.keep).toEqual(["s-keep"]);
    expect(plan.close.sort()).toEqual(["s-stop", "s-switch"]);
    expect(plan.start).toEqual([
      { userId: "b", appId: "570", gameName: "Dota 2" },
      { userId: "d", appId: "440", gameName: "TF2" },
    ]);
  });

  it("closes sessions of users missing from the poll and duplicate open sessions", () => {
    const plan = planSteamUpdates(
      [
        { id: "x1", userId: "x", appId: "730" },
        { id: "x2", userId: "x", appId: "730" },
        { id: "gone", userId: "y", appId: "730" },
      ],
      [{ userId: "x", appId: "730", gameName: null }],
    );
    expect(plan.keep).toEqual(["x1"]);
    expect(plan.close.sort()).toEqual(["gone", "x2"]);
  });
});

const s = (userId: string, startMin: number, endMin: number, gameId = "g") => ({
  userId,
  gameId,
  start: startMin * MIN,
  end: endMin * MIN,
});

describe("togetherSegments", () => {
  it("finds the overlap of two players", () => {
    expect(togetherSegments([s("a", 0, 60), s("b", 20, 90)])).toEqual([
      { gameId: "g", start: 20 * MIN, end: 60 * MIN, userIds: ["a", "b"], peak: 2 },
    ]);
  });

  it("ignores solo play, other games and short overlaps", () => {
    expect(togetherSegments([s("a", 0, 60), s("b", 0, 60, "other")])).toEqual([]);
    expect(togetherSegments([s("a", 0, 60), s("b", 57, 90)])).toEqual([]);
  });

  it("collects everyone who joined and the peak", () => {
    const [seg] = togetherSegments([s("a", 0, 100), s("b", 10, 50), s("c", 40, 100)]);
    expect(seg).toMatchObject({ start: 10 * MIN, end: 100 * MIN, peak: 3 });
    expect(seg.userIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("merges short dips (a restart) but splits long breaks", () => {
    const restart = togetherSegments([s("a", 0, 120), s("b", 0, 40), s("b", 43, 120)]);
    expect(restart).toHaveLength(1);
    expect(restart[0]).toMatchObject({ start: 0, end: 120 * MIN });

    const evening = togetherSegments([s("a", 0, 300), s("b", 0, 60), s("b", 180, 240)]);
    expect(evening.map((x) => [x.start / MIN, x.end / MIN])).toEqual([
      [180, 240],
      [0, 60],
    ]);
  });

  it("counts a user's overlapping sessions once (Steam + manual check-in)", () => {
    expect(togetherSegments([s("a", 0, 60), s("a", 10, 50)])).toEqual([]);
  });

  it("respects minPlayers", () => {
    const sessions = [s("a", 0, 60), s("b", 0, 60), s("c", 30, 60)];
    expect(togetherSegments(sessions, { minPlayers: 3 })).toMatchObject([
      { start: 30 * MIN, end: 60 * MIN, peak: 3 },
    ]);
  });
});

describe("playTotals / clip / formatDuration", () => {
  it("sums per user without double counting", () => {
    expect(playTotals([s("a", 0, 60), s("a", 30, 90), s("b", 0, 10)])).toEqual([
      { userId: "a", ms: 90 * MIN },
      { userId: "b", ms: 10 * MIN },
    ]);
  });

  it("clips to a window", () => {
    expect(clip([s("a", 0, 60), s("b", 100, 120)], 30 * MIN, 110 * MIN)).toEqual([
      s("a", 30, 60),
      s("b", 100, 110),
    ]);
  });

  it("formats durations", () => {
    expect(formatDuration(30_000)).toBe("不到 1 分钟");
    expect(formatDuration(45 * MIN)).toBe("45 分钟");
    expect(formatDuration(120 * MIN)).toBe("2 小时");
    expect(formatDuration(95 * MIN)).toBe("1 小时 35 分钟");
  });
});
