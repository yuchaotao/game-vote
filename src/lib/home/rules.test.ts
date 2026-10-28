import { describe, expect, it } from "vitest";
import { groupOf, isGroupTab, rememberable } from "./rules";

describe("rememberable", () => {
  it("keeps group pages, the group list and friends", () => {
    for (const p of [
      "/groups",
      "/friends",
      "/groups/abc",
      "/groups/abc/chat",
      "/groups/abc/games/g1",
      "/groups/abc/votes/r1",
    ]) {
      expect(rememberable(p), p).toBe(true);
    }
  });

  it("skips one-off pages", () => {
    for (const p of [
      "/",
      "/settings",
      "/login",
      "/invite/x",
      "/verify-email",
      "/groups/abc/other",
    ]) {
      expect(rememberable(p), p).toBe(false);
    }
  });
});

describe("default home page", () => {
  it("must be a group tab", () => {
    expect(isGroupTab("/groups/abc")).toBe(true);
    expect(isGroupTab("/groups/abc/votes")).toBe(true);
    expect(isGroupTab("/groups/abc/votes/r1")).toBe(false);
    expect(isGroupTab("/friends")).toBe(false);
    expect(groupOf("/groups/abc/games/g1")).toBe("abc");
    expect(groupOf("/friends")).toBeNull();
  });
});
