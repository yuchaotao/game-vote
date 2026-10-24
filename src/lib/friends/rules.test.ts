import { describe, expect, it, vi } from "vitest";
import { getSteamFriendIds } from "@/lib/auth/steam";
import { friendPair, inviteCodeFromPath, inviteStatus, parseMaxUses, safeNext } from "./rules";

describe("friendPair", () => {
  it("orders ids regardless of argument order", () => {
    expect(friendPair("b", "a")).toEqual({ userAId: "a", userBId: "b" });
    expect(friendPair("a", "b")).toEqual({ userAId: "a", userBId: "b" });
  });
});

describe("inviteStatus", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const base = { expiresAt: null, maxUses: null, uses: 0, revokedAt: null };

  it("is active by default", () => {
    expect(inviteStatus(base, now)).toBe("active");
  });
  it("revoked wins over everything", () => {
    expect(inviteStatus({ ...base, revokedAt: now, uses: 99, maxUses: 1 }, now)).toBe("revoked");
  });
  it("expires at the exact expiry time", () => {
    expect(inviteStatus({ ...base, expiresAt: now }, now)).toBe("expired");
    expect(inviteStatus({ ...base, expiresAt: new Date(now.getTime() + 1) }, now)).toBe("active");
  });
  it("is used up when uses reach maxUses", () => {
    expect(inviteStatus({ ...base, maxUses: 2, uses: 1 }, now)).toBe("active");
    expect(inviteStatus({ ...base, maxUses: 2, uses: 2 }, now)).toBe("used-up");
  });
  it("unlimited never runs out", () => {
    expect(inviteStatus({ ...base, uses: 10_000 }, now)).toBe("active");
  });
});

describe("parseMaxUses", () => {
  it("parses numbers and unlimited", () => {
    expect(parseMaxUses("5")).toBe(5);
    expect(parseMaxUses("unlimited")).toBeNull();
  });
});

describe("safeNext", () => {
  it.each(["/invite/abc", "/friends", "/"])("allows %j", (p) => {
    expect(safeNext(p)).toBe(p);
  });
  it.each(["https://evil.com", "//evil.com", "/\\evil.com", "invite", "", null, 42])(
    "rejects %j",
    (p) => {
      expect(safeNext(p)).toBeNull();
    },
  );
});

describe("inviteCodeFromPath", () => {
  it("extracts codes", () => {
    expect(inviteCodeFromPath("/invite/aB3_-x")).toBe("aB3_-x");
  });
  it.each(["/invite/", "/invite/a/b", "/friends", null])("rejects %j", (p) => {
    expect(inviteCodeFromPath(p)).toBeNull();
  });
});

describe("getSteamFriendIds", () => {
  const respond = (body: unknown, status = 200) =>
    vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;

  it("needs an API key", async () => {
    await expect(getSteamFriendIds("1", undefined)).resolves.toEqual({
      ok: false,
      reason: "no-key",
    });
  });
  it("returns friend ids", async () => {
    const f = respond({ friendslist: { friends: [{ steamid: "a" }, { steamid: "b" }] } });
    await expect(getSteamFriendIds("1", "k", f)).resolves.toEqual({
      ok: true,
      steamIds: ["a", "b"],
    });
  });
  it("reports a private friend list", async () => {
    await expect(getSteamFriendIds("1", "k", respond({}, 401))).resolves.toEqual({
      ok: false,
      reason: "private",
    });
  });
});
