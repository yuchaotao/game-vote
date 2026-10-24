import { describe, expect, it } from "vitest";
import { groupInfoSchema, inviteOutcome } from "./rules";

describe("inviteOutcome", () => {
  const base = { inviterIsOwner: false, isFriend: true, isMember: false, hasPendingRequest: false };

  it("owner invitations join immediately", () => {
    expect(inviteOutcome({ ...base, inviterIsOwner: true })).toBe("added");
  });
  it("owner invitation settles an existing pending request", () => {
    expect(inviteOutcome({ ...base, inviterIsOwner: true, hasPendingRequest: true })).toBe("added");
  });
  it("member invitations need approval", () => {
    expect(inviteOutcome(base)).toBe("requested");
  });
  it("no duplicate pending requests", () => {
    expect(inviteOutcome({ ...base, hasPendingRequest: true })).toBe("already-pending");
  });
  it("only friends can be invited", () => {
    expect(inviteOutcome({ ...base, isFriend: false })).toBe("not-friend");
    expect(inviteOutcome({ ...base, isFriend: false, inviterIsOwner: true })).toBe("not-friend");
  });
  it("members are reported as such", () => {
    expect(inviteOutcome({ ...base, isMember: true, isFriend: false })).toBe("already-member");
  });
});

describe("groupInfoSchema", () => {
  it("trims and defaults description", () => {
    expect(groupInfoSchema.parse({ name: "  周末开黑  " })).toEqual({
      name: "周末开黑",
      description: "",
    });
  });
  it("rejects empty and long names", () => {
    expect(groupInfoSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(groupInfoSchema.safeParse({ name: "x".repeat(41) }).success).toBe(false);
  });
});
