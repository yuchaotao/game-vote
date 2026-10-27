import { ChatMessageType, type Prisma } from "@prisma/client";
import IORedis from "ioredis";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { redis } from "@/lib/redis";
import type { ChatMessageDTO } from "./format";

const channel = (groupId: string) => `group:${groupId}:chat`;

const withAuthor = {
  author: { select: { id: true, displayName: true, avatarUrl: true } },
} satisfies Prisma.ChatMessageInclude;

type Row = Prisma.ChatMessageGetPayload<{ include: typeof withAuthor }>;

function toDTO(m: Row): ChatMessageDTO {
  return {
    id: m.id,
    type: m.type,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    author: m.author,
  };
}

/**
 * Newest `limit` messages older than the `beforeId` message, returned oldest
 * first. Ordered by (createdAt, id) so equal timestamps never skip messages.
 */
export async function listMessages(
  groupId: string,
  opts: { beforeId?: string; limit?: number } = {},
): Promise<{ messages: ChatMessageDTO[]; hasMore: boolean }> {
  const limit = Math.min(opts.limit ?? 50, 100);
  let older: Prisma.ChatMessageWhereInput = {};
  if (opts.beforeId) {
    const cursor = await db.chatMessage.findFirst({
      where: { id: opts.beforeId, groupId },
      select: { id: true, createdAt: true },
    });
    if (!cursor) return { messages: [], hasMore: false };
    older = {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    };
  }
  const rows = await db.chatMessage.findMany({
    where: { groupId, ...older },
    include: withAuthor,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  return {
    messages: rows.slice(0, limit).reverse().map(toDTO),
    hasMore: rows.length > limit,
  };
}

async function publish(groupId: string, message: ChatMessageDTO) {
  await redis().publish(channel(groupId), JSON.stringify(message));
}

export async function postMessage(
  groupId: string,
  authorId: string,
  body: string,
): Promise<ChatMessageDTO> {
  const row = await db.chatMessage.create({
    data: { groupId, authorId, body },
    include: withAuthor,
  });
  const dto = toDTO(row);
  await publish(groupId, dto);
  // Sending implies you've read everything up to your own message.
  await markRead(groupId, authorId, row.createdAt);
  return dto;
}

/**
 * App-generated notice in the group's chat (joins, renames, votes...).
 * `seenBy`: users the notice is about (the actor, the person who joined), for
 * whom it shouldn't count as unread.
 */
export async function postSystemMessage(
  groupId: string,
  body: string,
  seenBy: string[] = [],
): Promise<void> {
  const row = await db.chatMessage.create({
    data: { groupId, body, type: ChatMessageType.SYSTEM },
    include: withAuthor,
  });
  await Promise.all(seenBy.map((userId) => markRead(groupId, userId, row.createdAt)));
  await publish(groupId, toDTO(row));
}

export async function markRead(groupId: string, userId: string, at = new Date()) {
  await db.groupMember.updateMany({
    where: { groupId, userId, lastReadAt: { lt: at } },
    data: { lastReadAt: at },
  });
}

/** Unread message counts per group for the user (own messages excluded). */
export async function unreadCounts(userId: string): Promise<Record<string, number>> {
  const rows = await db.$queryRaw<{ groupId: string; count: bigint }[]>`
    SELECT m."groupId", COUNT(*) AS count
    FROM "ChatMessage" m
    JOIN "GroupMember" gm ON gm."groupId" = m."groupId" AND gm."userId" = ${userId}
    WHERE m."createdAt" > gm."lastReadAt"
      AND (m."authorId" IS NULL OR m."authorId" <> ${userId})
    GROUP BY m."groupId"`;
  return Object.fromEntries(rows.map((r) => [r.groupId, Number(r.count)]));
}

/**
 * Subscribes to a group's live messages. Each subscriber needs its own Redis
 * connection (a connection in subscribe mode can't run other commands).
 */
export async function subscribe(
  groupId: string,
  onMessage: (message: ChatMessageDTO) => void,
): Promise<() => Promise<void>> {
  const sub = new IORedis(env().REDIS_URL, { maxRetriesPerRequest: null });
  sub.on("message", (_channel, payload: string) => onMessage(JSON.parse(payload)));
  await sub.subscribe(channel(groupId));
  return async () => {
    sub.disconnect();
  };
}
