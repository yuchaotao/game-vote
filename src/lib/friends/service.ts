import { FriendRequestStatus, Prisma } from "@prisma/client";
import { getSteamFriendIds } from "@/lib/auth/steam";
import { randomToken } from "@/lib/auth/crypto";
import { parseFriendCode } from "@/lib/auth/validation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { notify } from "@/lib/notify/service";
import { redis } from "@/lib/redis";
import { friendPair, inviteStatus, type InviteStatus } from "./rules";

export const publicUser = {
  id: true,
  username: true,
  friendTag: true,
  displayName: true,
  avatarUrl: true,
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUser }>;

export async function areFriends(a: string, b: string): Promise<boolean> {
  const row = await db.friendship.findUnique({ where: { userAId_userBId: friendPair(a, b) } });
  return Boolean(row);
}

/** Creates the friendship if missing and closes any pending requests between the two. */
async function befriend(
  tx: Prisma.TransactionClient,
  a: string,
  b: string,
  source: "request" | "invite",
) {
  await tx.friendship.upsert({
    where: { userAId_userBId: friendPair(a, b) },
    create: { ...friendPair(a, b), source },
    update: {},
  });
  await tx.friendRequest.updateMany({
    where: {
      status: FriendRequestStatus.PENDING,
      OR: [
        { fromId: a, toId: b },
        { fromId: b, toId: a },
      ],
    },
    data: { status: FriendRequestStatus.ACCEPTED, respondedAt: new Date() },
  });
}

export async function listFriends(userId: string): Promise<(PublicUser & { since: Date })[]> {
  const rows = await db.friendship.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    include: { userA: { select: publicUser }, userB: { select: publicUser } },
  });
  return rows
    .map((r) => ({ ...(r.userAId === userId ? r.userB : r.userA), since: r.createdAt }))
    .sort((x, y) => x.displayName.localeCompare(y.displayName, "zh-CN"));
}

export async function listRequests(userId: string) {
  const [incoming, outgoing] = await Promise.all([
    db.friendRequest.findMany({
      where: { toId: userId, status: FriendRequestStatus.PENDING },
      include: { from: { select: publicUser } },
      orderBy: { createdAt: "desc" },
    }),
    db.friendRequest.findMany({
      where: { fromId: userId, status: FriendRequestStatus.PENDING },
      include: { to: { select: publicUser } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { incoming, outgoing };
}

export function countIncomingRequests(userId: string): Promise<number> {
  return db.friendRequest.count({ where: { toId: userId, status: FriendRequestStatus.PENDING } });
}

export type SendResult =
  | { kind: "sent"; to: PublicUser }
  | { kind: "accepted"; to: PublicUser }
  | { kind: "already-pending" }
  | { kind: "already-friends" }
  | { kind: "self" }
  | { kind: "not-found" };

async function sendRequestToUser(fromId: string, to: PublicUser): Promise<SendResult> {
  if (to.id === fromId) return { kind: "self" };
  if (await areFriends(fromId, to.id)) return { kind: "already-friends" };

  // They already asked us: treat as mutual and accept.
  const reverse = await db.friendRequest.findUnique({
    where: { fromId_toId: { fromId: to.id, toId: fromId } },
  });
  if (reverse?.status === FriendRequestStatus.PENDING) {
    await db.$transaction((tx) => befriend(tx, fromId, to.id, "request"));
    return { kind: "accepted", to };
  }

  const existing = await db.friendRequest.findUnique({
    where: { fromId_toId: { fromId, toId: to.id } },
  });
  if (existing?.status === FriendRequestStatus.PENDING) return { kind: "already-pending" };

  await db.friendRequest.upsert({
    where: { fromId_toId: { fromId, toId: to.id } },
    create: { fromId, toId: to.id },
    update: { status: FriendRequestStatus.PENDING, createdAt: new Date(), respondedAt: null },
  });
  const from = await db.user.findUniqueOrThrow({
    where: { id: fromId },
    select: { displayName: true },
  });
  await notify("FRIEND_REQUEST", [to.id], {
    title: `${from.displayName} 想加你为好友`,
    body: `${from.displayName} 向你发送了好友申请，去好友页面接受或拒绝。`,
    path: "/friends",
  });
  return { kind: "sent", to };
}

export async function sendRequestByCode(fromId: string, code: string): Promise<SendResult> {
  const parsed = parseFriendCode(code);
  if (!parsed) return { kind: "not-found" };
  const to = await db.user.findFirst({ where: parsed, select: publicUser });
  if (!to) return { kind: "not-found" };
  return sendRequestToUser(fromId, to);
}

export async function sendRequestById(fromId: string, toId: string): Promise<SendResult> {
  const to = await db.user.findUnique({ where: { id: toId }, select: publicUser });
  if (!to) return { kind: "not-found" };
  return sendRequestToUser(fromId, to);
}

/** Accepts or declines a pending request addressed to `userId`. */
export async function respondToRequest(
  userId: string,
  requestId: string,
  accept: boolean,
): Promise<boolean> {
  const req = await db.friendRequest.findUnique({ where: { id: requestId } });
  if (!req || req.toId !== userId || req.status !== FriendRequestStatus.PENDING) return false;
  if (accept) {
    await db.$transaction((tx) => befriend(tx, req.fromId, req.toId, "request"));
  } else {
    await db.friendRequest.update({
      where: { id: req.id },
      data: { status: FriendRequestStatus.DECLINED, respondedAt: new Date() },
    });
  }
  return true;
}

export async function cancelRequest(userId: string, requestId: string): Promise<boolean> {
  const { count } = await db.friendRequest.updateMany({
    where: { id: requestId, fromId: userId, status: FriendRequestStatus.PENDING },
    data: { status: FriendRequestStatus.CANCELLED, respondedAt: new Date() },
  });
  return count === 1;
}

export async function removeFriend(userId: string, friendId: string): Promise<boolean> {
  const { count } = await db.friendship.deleteMany({ where: friendPair(userId, friendId) });
  return count === 1;
}

// --- Invite links ---

export async function createInvite(
  creatorId: string,
  opts: { expiresInMs: number | null; maxUses: number | null },
) {
  return db.inviteLink.create({
    data: {
      code: randomToken(12),
      creatorId,
      expiresAt: opts.expiresInMs ? new Date(Date.now() + opts.expiresInMs) : null,
      maxUses: opts.maxUses,
    },
  });
}

export async function listInvites(creatorId: string) {
  const invites = await db.inviteLink.findMany({
    where: { creatorId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return invites.map((i) => ({ ...i, status: inviteStatus(i) }));
}

export async function revokeInvite(creatorId: string, inviteId: string): Promise<boolean> {
  const { count } = await db.inviteLink.updateMany({
    where: { id: inviteId, creatorId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count === 1;
}

export async function findInvite(code: string) {
  const invite = await db.inviteLink.findUnique({
    where: { code },
    include: { creator: { select: publicUser } },
  });
  return invite ? { ...invite, status: inviteStatus(invite) } : null;
}

export type RedeemResult =
  | { kind: "befriended"; creator: PublicUser }
  | { kind: "already-friends"; creator: PublicUser }
  | { kind: "own-invite" }
  | { kind: "invalid"; status: InviteStatus | "not-found" };

export async function redeemInvite(userId: string, code: string): Promise<RedeemResult> {
  const invite = await findInvite(code);
  if (!invite) return { kind: "invalid", status: "not-found" };
  if (invite.creatorId === userId) return { kind: "own-invite" };
  if (await areFriends(userId, invite.creatorId)) {
    return { kind: "already-friends", creator: invite.creator };
  }
  if (invite.status !== "active") return { kind: "invalid", status: invite.status };

  return db.$transaction(async (tx) => {
    // Claim a use atomically so concurrent redemptions can't exceed maxUses.
    const claimed = await tx.inviteLink.updateMany({
      where: {
        id: invite.id,
        revokedAt: null,
        ...(invite.maxUses !== null && { uses: { lt: invite.maxUses } }),
      },
      data: { uses: { increment: 1 } },
    });
    if (claimed.count !== 1) return { kind: "invalid", status: "used-up" } as const;

    // A user may redeem again after unfriending; keep one record per user.
    await tx.inviteRedemption.upsert({
      where: { inviteId_userId: { inviteId: invite.id, userId } },
      create: { inviteId: invite.id, userId },
      update: { createdAt: new Date() },
    });
    await befriend(tx, userId, invite.creatorId, "invite");
    return { kind: "befriended", creator: invite.creator } as const;
  });
}

// --- Steam friend suggestions ---

export type SteamSuggestions =
  | { ok: true; users: PublicUser[] }
  | { ok: false; reason: "not-linked" | "no-key" | "private" | "error" };

export async function steamSuggestions(userId: string): Promise<SteamSuggestions> {
  const account = await db.account.findUnique({
    where: { userId_provider: { userId, provider: "steam" } },
  });
  if (!account) return { ok: false, reason: "not-linked" };

  // Cache the Steam call; the friend list rarely changes and the API is rate limited.
  const cacheKey = `steam:friends:${account.providerAccountId}`;
  let steamIds: string[];
  const cached = await redis().get(cacheKey);
  if (cached) {
    steamIds = JSON.parse(cached) as string[];
  } else {
    const list = await getSteamFriendIds(account.providerAccountId, env().STEAM_API_KEY);
    if (!list.ok) return list;
    steamIds = list.steamIds;
    await redis().set(cacheKey, JSON.stringify(steamIds), "EX", 10 * 60);
  }
  if (steamIds.length === 0) return { ok: true, users: [] };

  const [onSite, friends, pending] = await Promise.all([
    db.account.findMany({
      where: { provider: "steam", providerAccountId: { in: steamIds } },
      select: { user: { select: publicUser } },
    }),
    listFriends(userId),
    db.friendRequest.findMany({
      where: { fromId: userId, status: FriendRequestStatus.PENDING },
      select: { toId: true },
    }),
  ]);
  const exclude = new Set([userId, ...friends.map((f) => f.id), ...pending.map((p) => p.toId)]);
  return { ok: true, users: onSite.map((a) => a.user).filter((u) => !exclude.has(u.id)) };
}
