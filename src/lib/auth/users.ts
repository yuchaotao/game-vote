import { AuthTokenType, Prisma, type User } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import { randomFriendTag, randomToken, sha256 } from "./crypto";
import { usernameFromText } from "./validation";

export type Provider = "steam" | "discord";

/** Returns `base`, or `base` plus a numeric suffix, that no user has yet. */
export async function availableUsername(base: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base.slice(0, 16)}${Math.floor(Math.random() * 10_000)}`;
    const taken = await db.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  throw new Error("Could not find an available username");
}

export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  if (!field) return true;
  const target = err.meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target).includes(field);
}

export async function createLocalUser(input: {
  username: string;
  displayName?: string;
  email: string;
  passwordHash: string;
}): Promise<User> {
  return db.user.create({
    data: {
      username: input.username,
      displayName: input.displayName ?? input.username,
      email: input.email,
      passwordHash: input.passwordHash,
      friendTag: randomFriendTag(),
    },
  });
}

export type ExternalProfile = {
  provider: Provider;
  providerAccountId: string;
  displayName: string;
  avatarUrl?: string;
};

export async function findUserByAccount(provider: Provider, providerAccountId: string) {
  const account = await db.account.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    include: { user: true },
  });
  return account?.user ?? null;
}

/** Creates a new user whose only login method is the given external account. */
export async function createUserFromProfile(profile: ExternalProfile): Promise<User> {
  const username = await availableUsername(usernameFromText(profile.displayName));
  return db.user.create({
    data: {
      username,
      displayName: profile.displayName.slice(0, 32) || username,
      avatarUrl: profile.avatarUrl,
      friendTag: randomFriendTag(),
      accounts: {
        create: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
        },
      },
    },
  });
}

export type LinkResult = "linked" | "already-linked" | "taken-by-other" | "provider-in-use";

export async function linkAccount(userId: string, profile: ExternalProfile): Promise<LinkResult> {
  const existing = await db.account.findUnique({
    where: {
      provider_providerAccountId: {
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
      },
    },
  });
  if (existing) return existing.userId === userId ? "already-linked" : "taken-by-other";

  try {
    await db.account.create({
      data: {
        userId,
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return "provider-in-use";
    throw err;
  }
  // Adopt the external avatar if the user has none yet.
  if (profile.avatarUrl) {
    await db.user.updateMany({
      where: { id: userId, avatarUrl: null },
      data: { avatarUrl: profile.avatarUrl },
    });
  }
  return "linked";
}

/**
 * Whether removing the given provider would leave the user unable to sign in.
 * A user can sign in with username + password, Steam, or a linked Discord.
 */
export function canUnlink(
  user: { passwordHash: string | null; accounts: { provider: string }[] },
  provider: Provider,
): boolean {
  const others = user.accounts.filter((a) => a.provider !== provider);
  return Boolean(user.passwordHash) || others.length > 0;
}

// --- Email verification & password reset tokens ---

const TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  EMAIL_VERIFY: 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 60 * 60 * 1000,
};

async function issueToken(userId: string, type: AuthTokenType): Promise<string> {
  const token = randomToken();
  // Only the newest token of each type stays valid.
  await db.authToken.deleteMany({ where: { userId, type, usedAt: null } });
  await db.authToken.create({
    data: {
      userId,
      type,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS[type]),
    },
  });
  return token;
}

/** Marks the token used and returns its user id, or null if invalid/expired/used. */
export async function consumeToken(token: string, type: AuthTokenType): Promise<string | null> {
  const record = await db.authToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record || record.type !== type || record.usedAt || record.expiresAt < new Date()) {
    return null;
  }
  const { count } = await db.authToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1 ? record.userId : null;
}

export async function sendVerificationEmail(user: {
  id: string;
  email: string;
  displayName: string;
}) {
  const token = await issueToken(user.id, AuthTokenType.EMAIL_VERIFY);
  const url = `${env().APP_URL}/verify-email?token=${token}`;
  await sendMail({
    to: user.email,
    subject: "Game Vote：验证你的邮箱",
    text: `${user.displayName}，你好：\n\n点击以下链接验证邮箱（24 小时内有效）：\n${url}\n\n如果不是你本人操作，请忽略此邮件。`,
  });
}

export async function sendPasswordResetEmail(user: {
  id: string;
  email: string;
  displayName: string;
}) {
  const token = await issueToken(user.id, AuthTokenType.PASSWORD_RESET);
  const url = `${env().APP_URL}/reset-password?token=${token}`;
  await sendMail({
    to: user.email,
    subject: "Game Vote：重置密码",
    text: `${user.displayName}，你好：\n\n点击以下链接重置密码（1 小时内有效）：\n${url}\n\n如果不是你本人操作，请忽略此邮件。`,
  });
}
