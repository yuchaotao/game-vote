import { describe, expect, it } from "vitest";
import {
  canCast,
  deadlineError,
  replayFrames,
  endReasonText,
  nextReveal,
  resultsHidden,
  roundSettingsSchema,
  standings,
  winnerOf,
} from "./rules";

const c = (gameId: string, minute: number) => ({
  gameId,
  addedAt: new Date(Date.UTC(2026, 9, 28, 20, minute)),
});

describe("standings", () => {
  const candidates = [c("a", 0), c("b", 1), c("c", 2)];

  it("ranks by votes and lists voters", () => {
    const s = standings(candidates, [
      { gameId: "b", userId: "u1" },
      { gameId: "b", userId: "u2" },
      { gameId: "c", userId: "u1" },
    ]);
    expect(s.map((x) => [x.gameId, x.votes, x.rank])).toEqual([
      ["b", 2, 1],
      ["c", 1, 2],
      ["a", 0, 3],
    ]);
    expect(s[0].voterIds).toEqual(["u1", "u2"]);
    expect(winnerOf(s)).toBe("b");
  });

  it("orders ties by hot score, then by who was added first, sharing the rank", () => {
    const ballots = [
      { gameId: "a", userId: "u1" },
      { gameId: "b", userId: "u2" },
      { gameId: "c", userId: "u3" },
    ];
    const s = standings(candidates, ballots, { c: 50 });
    expect(s.map((x) => [x.gameId, x.rank])).toEqual([
      ["c", 1],
      ["a", 1],
      ["b", 1],
    ]);
  });

  it("has no winner without votes and ignores votes for non-candidates", () => {
    const s = standings(candidates, [{ gameId: "zzz", userId: "u1" }]);
    expect(s.every((x) => x.votes === 0)).toBe(true);
    expect(winnerOf(s)).toBeNull();
    expect(winnerOf([])).toBeNull();
  });
});

describe("canCast", () => {
  it("enforces one vote per game and the per-person limit", () => {
    expect(canCast([], "a", 3, true)).toEqual({ ok: true });
    expect(canCast(["a"], "a", 3, true).ok).toBe(false);
    expect(canCast(["a", "b", "c"], "d", 3, true)).toEqual({
      ok: false,
      error: "每人最多 3 票，先取消一票再投",
    });
    expect(canCast([], "x", 3, false).ok).toBe(false);
  });
});

describe("replayFrames", () => {
  it("rebuilds standings after every event, in time order", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 9, 28, 20, m));
    const frames = replayFrames([
      { kind: "CAST", userId: "u1", gameId: "b", at: at(3) },
      { kind: "CANDIDATE", userId: "u1", gameId: "a", at: at(0) },
      { kind: "CANDIDATE", userId: "u2", gameId: "b", at: at(1) },
      { kind: "CAST", userId: "u2", gameId: "a", at: at(2) },
      { kind: "CAST", userId: "u3", gameId: "b", at: at(4) },
      { kind: "RETRACT", userId: "u1", gameId: "b", at: at(5) },
    ]);
    const leader = frames.map((f) => `${f.standings[0]?.gameId}:${f.standings[0]?.votes}`);
    // At 1–1 the earlier candidate (a) leads.
    expect(leader).toEqual(["a:0", "a:0", "a:1", "a:1", "b:2", "a:1"]);
    expect(frames[1].standings).toHaveLength(2);
  });
});

describe("round settings", () => {
  it("parses defaults and an ISO deadline", () => {
    expect(roundSettingsSchema.parse({ title: " 周五 ", maxVotes: "", deadline: "" })).toEqual({
      title: "周五",
      maxVotes: 3,
      deadline: null,
      anonymous: false,
    });
    const r = roundSettingsSchema.parse({
      title: "",
      maxVotes: "2",
      deadline: "2026-10-30T12:00:00.000Z",
    });
    expect(r.deadline?.toISOString()).toBe("2026-10-30T12:00:00.000Z");
    expect(roundSettingsSchema.safeParse({ title: "", maxVotes: "0", deadline: "" }).success).toBe(
      false,
    );
    expect(
      roundSettingsSchema.safeParse({ title: "", maxVotes: "3", deadline: "nope" }).success,
    ).toBe(false);
  });

  it("checks the deadline window", () => {
    const now = Date.UTC(2026, 9, 28);
    expect(deadlineError(null, now)).toBeNull();
    expect(deadlineError(new Date(now + 30_000), now)).toMatch("至少 1 分钟");
    expect(deadlineError(new Date(now + 31 * 86_400_000), now)).toMatch("30 天");
    expect(deadlineError(new Date(now + 3_600_000), now)).toBeNull();
  });
});

describe("anonymous rounds", () => {
  it("need a reveal time", () => {
    const ok = roundSettingsSchema.safeParse({
      title: "",
      maxVotes: "3",
      deadline: "2026-10-30T04:00:00.000Z",
      anonymous: "on",
    });
    expect(ok.success && ok.data.anonymous).toBe(true);
    const missing = roundSettingsSchema.safeParse({
      title: "",
      maxVotes: "3",
      deadline: "",
      anonymous: "on",
    });
    expect(missing.success).toBe(false);
  });

  it("reveal by default on the next Friday 12:00 Beijing time", () => {
    // Wednesday 10:00 Beijing -> this Friday.
    expect(nextReveal(new Date("2026-10-28T02:00:00Z")).toISOString()).toBe(
      "2026-10-30T04:00:00.000Z",
    );
    // Friday 11:58 Beijing -> today at noon; 11:59:30 -> too close, next week.
    expect(nextReveal(new Date("2026-10-30T03:58:00Z")).toISOString()).toBe(
      "2026-10-30T04:00:00.000Z",
    );
    expect(nextReveal(new Date("2026-10-30T03:59:30Z")).toISOString()).toBe(
      "2026-11-06T04:00:00.000Z",
    );
    // Friday 13:00 and Saturday 01:00 Beijing (still Friday in UTC) -> next week.
    expect(nextReveal(new Date("2026-10-30T05:00:00Z")).toISOString()).toBe(
      "2026-11-06T04:00:00.000Z",
    );
    expect(nextReveal(new Date("2026-10-30T17:00:00Z")).toISOString()).toBe(
      "2026-11-06T04:00:00.000Z",
    );
  });

  it("hide results while open, unless you peeked", () => {
    expect(resultsHidden({ anonymous: true, status: "OPEN" }, false)).toBe(true);
    expect(resultsHidden({ anonymous: true, status: "OPEN" }, true)).toBe(false);
    expect(resultsHidden({ anonymous: true, status: "ENDED" }, false)).toBe(false);
    expect(resultsHidden({ anonymous: false, status: "OPEN" }, false)).toBe(false);
    expect(endReasonText("DEADLINE", true)).toBe("到点揭榜");
    expect(endReasonText("DEADLINE", false)).toBe("到达截止时间");
  });
});
