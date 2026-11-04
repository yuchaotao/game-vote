import { describe, expect, it } from "vitest";
import { replayFrames } from "./rules";
import { coinTier, LUCK, nextLuck, swapOptions, wins } from "./gamble-rules";

describe("lucky coin", () => {
  it("starts at 50%; +5% per win up to 90%, −1% per loss down to 10%", () => {
    expect(LUCK.start).toBe(50);
    expect(nextLuck(50, true)).toBe(55);
    expect(nextLuck(88, true)).toBe(90);
    expect(nextLuck(90, true)).toBe(90);
    expect(nextLuck(50, false)).toBe(49);
    expect(nextLuck(10, false)).toBe(10);
  });

  it("wins when the roll is under the luck", () => {
    expect(wins(50, 49)).toBe(true);
    expect(wins(50, 50)).toBe(false);
    expect(wins(100, 99)).toBe(true);
    expect(wins(0, 0)).toBe(false);
  });

  it("looks better as it climbs", () => {
    expect([45, 50, 60, 70, 80, 90].map(coinTier)).toEqual([
      "rusty",
      "copper",
      "silver",
      "gold",
      "shining",
      "rainbow",
    ]);
  });
});

describe("swapOptions", () => {
  const ballots = [
    { userId: "me", gameId: "a", count: 1 },
    { userId: "x", gameId: "b", count: 2 },
    { userId: "y", gameId: "a", count: 1 },
    { userId: "y", gameId: "b", count: 1 },
  ];

  it("moves someone else's vote to one of my games, never a no-op", () => {
    expect(swapOptions("me", ballots, true)).toEqual([
      { victimId: "x", fromGameId: "b", toGameId: "a" },
      { victimId: "y", fromGameId: "b", toGameId: "a" },
    ]);
  });

  it("respects one vote per game", () => {
    // y already votes for a, so y's vote for b can't become a second one.
    expect(swapOptions("me", ballots, false)).toEqual([
      { victimId: "x", fromGameId: "b", toGameId: "a" },
    ]);
  });

  it("needs votes of my own", () => {
    expect(swapOptions("z", ballots, true).every((s) => s.victimId !== "z")).toBe(true);
    expect(swapOptions("nobody", [{ userId: "x", gameId: "b", count: 1 }], true)).toEqual([]);
  });
});

describe("replay of a switched vote", () => {
  it("moves one vote from the old game to the new one", () => {
    const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
    const frames = replayFrames([
      { userId: "u", gameId: "a", kind: "CANDIDATE", at: at(0) },
      { userId: "u", gameId: "b", kind: "CANDIDATE", at: at(1) },
      { userId: "v", gameId: "a", kind: "CAST", at: at(2) },
      { userId: "v", gameId: "a", toGameId: "b", actorId: "u", kind: "SWAP", at: at(3) },
    ]);
    const last = frames.at(-1)!.standings;
    expect(last.find((s) => s.gameId === "b")).toMatchObject({ votes: 1, voterIds: ["v"] });
    expect(last.find((s) => s.gameId === "a")).toMatchObject({ votes: 0 });
  });
});
