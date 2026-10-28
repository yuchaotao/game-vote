import { describe, expect, it } from "vitest";
import { hotness, HOTNESS } from "./hotness";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 9, 28, 20);
const old = new Date(now - 60 * DAY); // added long ago: no freshness boost

const play = (userId: string, gameId: string, startH: number, endH: number) => ({
  userId,
  gameId,
  start: now + startH * HOUR,
  end: now + endH * HOUR,
});

describe("hotness", () => {
  it("is zero for an old game nobody played", () => {
    expect(hotness([{ gameId: "g", addedAt: old }], [], [], now).g).toEqual({
      score: 0,
      play: 0,
      together: 0,
      votes: 0,
      fresh: 0,
    });
  });

  it("gives new games a boost that fades over a week", () => {
    const score = (ageDays: number) =>
      hotness([{ gameId: "g", addedAt: new Date(now - ageDays * DAY) }], [], [], now).g.fresh;
    expect(score(0)).toBe(HOTNESS.fresh);
    expect(score(3.5)).toBe(HOTNESS.fresh / 2);
    expect(score(8)).toBe(0);
  });

  it("weights playing together far above playing alone", () => {
    const games = [
      { gameId: "solo", addedAt: old },
      { gameId: "group", addedAt: old },
    ];
    const h = hotness(
      games,
      [
        // Two people, 2h each, but at different times.
        play("a", "solo", -2, 0),
        play("b", "solo", -30, -28),
        // Three people, 2h, at the same time.
        play("a", "group", -2, 0),
        play("b", "group", -2, 0),
        play("c", "group", -2, 0),
      ],
      [],
      now,
    );
    expect(h.solo.together).toBe(0);
    expect(h.group.together).toBeGreaterThan(0);
    expect(h.group.score).toBeGreaterThan(h.solo.score);
    // 3 people x 2h, 1h-ago midpoint: barely decayed.
    expect(h.group.play).toBeCloseTo(60, 0);
    expect(h.group.together).toBeCloseTo(HOTNESS.perTogetherPlayerHour * 3 * 2, -1);
  });

  it("decays older play and ignores play outside the window", () => {
    const g = [{ gameId: "g", addedAt: old }];
    const lastWeek = hotness(g, [play("a", "g", -7 * 24 - 1, -7 * 24 + 1)], [], now).g.play;
    expect(lastWeek).toBeCloseTo(HOTNESS.perPlayHour, 0); // 2h at half weight
    expect(hotness(g, [play("a", "g", -15 * 24, -15 * 24 + 5)], [], now).g.score).toBe(0);
  });

  it("counts recent votes and ignores unknown games", () => {
    const h = hotness(
      [{ gameId: "g", addedAt: old }],
      [play("a", "other", -1, 0)],
      [
        { gameId: "g", castAt: new Date(now) },
        { gameId: "g", castAt: new Date(now - 7 * DAY) },
        { gameId: "g", castAt: new Date(now - 20 * DAY) },
        { gameId: "other", castAt: new Date(now) },
      ],
      now,
    );
    expect(h.g.votes).toBe(HOTNESS.perVote * 1.5);
    expect(h.other).toBeUndefined();
  });
});
