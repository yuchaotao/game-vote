// Pure helpers for the friends domain (no I/O), unit-tested.

/** Friendship rows are stored once, ordered so userAId < userBId. */
export function friendPair(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

export type InviteState = {
  expiresAt: Date | null;
  maxUses: number | null;
  uses: number;
  revokedAt: Date | null;
};

export type InviteStatus = "active" | "revoked" | "expired" | "used-up";

export function inviteStatus(invite: InviteState, now = new Date()): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt && invite.expiresAt <= now) return "expired";
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return "used-up";
  return "active";
}

export const INVITE_EXPIRY_OPTIONS = {
  "1d": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  never: null,
} as const;

export type InviteExpiry = keyof typeof INVITE_EXPIRY_OPTIONS;

export const INVITE_MAX_USES_OPTIONS = ["1", "5", "20", "unlimited"] as const;

export function parseMaxUses(raw: string): number | null {
  return raw === "unlimited" ? null : Number.parseInt(raw, 10);
}

/** Only allow same-site relative redirects like `/invite/abc`. */
export function safeNext(next: unknown): string | null {
  if (typeof next !== "string") return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  return next;
}

/** Extracts the invite code from a `/invite/<code>` path. */
export function inviteCodeFromPath(path: string | null): string | null {
  return path ? (/^\/invite\/([\w-]+)$/.exec(path)?.[1] ?? null) : null;
}
