import { describe, expect, it } from "vitest";
import {
  formatFriendCode,
  parseFriendCode,
  registerSchema,
  usernameFromText,
  usernameSchema,
} from "./validation";

describe("usernameSchema", () => {
  it("lowercases and trims", () => {
    expect(usernameSchema.parse("  Harry_01 ")).toBe("harry_01");
  });
  it("accepts Chinese characters", () => {
    expect(usernameSchema.parse("小明同学")).toBe("小明同学");
  });
  it.each(["ab", "a".repeat(21), "has space", "bad#char", "emoji😀x"])("rejects %j", (v) => {
    expect(usernameSchema.safeParse(v).success).toBe(false);
  });
});

describe("registerSchema", () => {
  const valid = { username: "harry", email: "Harry@Example.com", password: "12345678" };
  it("normalizes email and defaults displayName", () => {
    const r = registerSchema.parse({ ...valid, displayName: "" });
    expect(r.email).toBe("harry@example.com");
    expect(r.displayName).toBeUndefined();
  });
  it("requires 8+ char password", () => {
    expect(registerSchema.safeParse({ ...valid, password: "short" }).success).toBe(false);
  });
});

describe("friend codes", () => {
  it("round-trips", () => {
    const code = formatFriendCode({ username: "harry", friendTag: "0420" });
    expect(code).toBe("harry#0420");
    expect(parseFriendCode(code)).toEqual({ username: "harry", friendTag: "0420" });
  });
  it("is case-insensitive on the name", () => {
    expect(parseFriendCode(" Harry#0420 ")).toEqual({ username: "harry", friendTag: "0420" });
  });
  it.each(["harry", "harry#12", "harry#12345", "#1234", "a b#1234"])("rejects %j", (v) => {
    expect(parseFriendCode(v)).toBeNull();
  });
});

describe("usernameFromText", () => {
  it("strips invalid characters", () => {
    expect(usernameFromText("Cool Gamer!!")).toBe("coolgamer");
  });
  it("pads too-short results", () => {
    expect(usernameFromText("✨")).toBe("player");
    expect(usernameFromText("A")).toBe("playera");
  });
  it("truncates long names", () => {
    expect(usernameFromText("x".repeat(40))).toHaveLength(16);
  });
});
