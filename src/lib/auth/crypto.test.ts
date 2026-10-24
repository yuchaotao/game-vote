import { describe, expect, it } from "vitest";
import { canUnlink } from "./users";
import { hashPassword, randomFriendTag, randomToken, sha256, verifyPassword } from "./crypto";

describe("passwords", () => {
  it("verifies the right password only", async () => {
    const h = await hashPassword("correct horse");
    expect(h).not.toContain("correct horse");
    await expect(verifyPassword(h, "correct horse")).resolves.toBe(true);
    await expect(verifyPassword(h, "wrong")).resolves.toBe(false);
  });
  it("returns false for a malformed hash", async () => {
    await expect(verifyPassword("not-a-hash", "x")).resolves.toBe(false);
  });
});

describe("tokens", () => {
  it("are random and url-safe", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
  });
  it("sha256 is stable hex", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("friend tags are 4 digits", () => {
    for (let i = 0; i < 50; i++) expect(randomFriendTag()).toMatch(/^\d{4}$/);
  });
});

describe("canUnlink", () => {
  const steam = { provider: "steam" };
  const discord = { provider: "discord" };
  it("blocks removing the only login method", () => {
    expect(canUnlink({ passwordHash: null, accounts: [steam] }, "steam")).toBe(false);
  });
  it("allows when a password exists", () => {
    expect(canUnlink({ passwordHash: "h", accounts: [steam] }, "steam")).toBe(true);
  });
  it("allows when another account remains", () => {
    expect(canUnlink({ passwordHash: null, accounts: [steam, discord] }, "steam")).toBe(true);
  });
});
