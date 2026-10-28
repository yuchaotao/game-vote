import { JoinRequestStatus } from "@prisma/client";
import { postSystemMessage } from "@/lib/chat/service";
import { db } from "@/lib/db";
import { friendPair } from "@/lib/friends/rules";
import { listFriends, publicUser, type PublicUser } from "@/lib/friends/service";
import { env } from "@/lib/env";
import { listTextChannels, postToChannel } from "@/lib/notify/discord-bot";
import { notify } from "@/lib/notify/service";
import { inviteOutcome, type InviteOutcome } from "./rules";

export class GroupError extends Error {}

const activeGroup = (groupId: string) => ({ id: groupId, dissolvedAt: null });

async function nameOf(userId: string): Promise<string> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  return u?.displayName ?? "某人";
}

export async function createGroup(ownerId: string, info: { name: string; description: string }) {
  const group = await db.group.create({
    data: { ...info, ownerId, members: { create: { userId: ownerId } } },
  });
  await postSystemMessage(group.id, `${await nameOf(ownerId)} 创建了群`, [ownerId]);
  return group;
}

export async function isActiveMember(groupId: string, userId: string): Promise<boolean> {
  const n = await db.groupMember.count({
    where: { groupId, userId, group: { dissolvedAt: null } },
  });
  return n > 0;
}

export async function listMyGroups(userId: string) {
  const groups = await db.group.findMany({
    where: { dissolvedAt: null, members: { some: { userId } } },
    include: {
      owner: { select: publicUser },
      _count: {
        select: { members: true, joinRequests: { where: { status: JoinRequestStatus.PENDING } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return groups.map((g) => ({
    ...g,
    isOwner: g.ownerId === userId,
    memberCount: g._count.members,
    // Only the owner acts on pending requests.
    pendingCount: g.ownerId === userId ? g._count.joinRequests : 0,
  }));
}

/** Pending requests across all groups the user owns (header badge). */
export function countPendingApprovals(ownerId: string): Promise<number> {
  return db.groupJoinRequest.count({
    where: { status: JoinRequestStatus.PENDING, group: { ownerId, dissolvedAt: null } },
  });
}

/** The group as seen by one of its members, or null if not a member / dissolved. */
export async function getGroupForMember(groupId: string, userId: string) {
  const group = await db.group.findFirst({
    where: { ...activeGroup(groupId), members: { some: { userId } } },
    include: {
      members: { include: { user: { select: publicUser } }, orderBy: { joinedAt: "asc" } },
      joinRequests: {
        where: { status: JoinRequestStatus.PENDING },
        include: { user: { select: publicUser }, invitedBy: { select: publicUser } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!group) return null;
  return { ...group, isOwner: group.ownerId === userId };
}

async function requireMember(groupId: string, userId: string) {
  const group = await db.group.findFirst({
    where: { ...activeGroup(groupId), members: { some: { userId } } },
  });
  if (!group) throw new GroupError("群不存在或你不是成员");
  return group;
}

async function requireOwner(groupId: string, userId: string) {
  const group = await requireMember(groupId, userId);
  if (group.ownerId !== userId) throw new GroupError("只有群主可以这样做");
  return group;
}

/** Friends of `userId` who are neither members nor pending for the group. */
export async function invitableFriends(groupId: string, userId: string): Promise<PublicUser[]> {
  const [friends, members, pending] = await Promise.all([
    listFriends(userId),
    db.groupMember.findMany({ where: { groupId }, select: { userId: true } }),
    db.groupJoinRequest.findMany({
      where: { groupId, status: JoinRequestStatus.PENDING },
      select: { userId: true },
    }),
  ]);
  const exclude = new Set([...members, ...pending].map((m) => m.userId));
  return friends.filter((f) => !exclude.has(f.id));
}

export async function inviteToGroup(
  groupId: string,
  inviterId: string,
  inviteeIds: string[],
): Promise<Record<string, InviteOutcome>> {
  const group = await requireMember(groupId, inviterId);
  const inviterIsOwner = group.ownerId === inviterId;
  const results: Record<string, InviteOutcome> = {};

  for (const inviteeId of new Set(inviteeIds)) {
    const [friendship, membership, pending] = await Promise.all([
      db.friendship.findUnique({ where: { userAId_userBId: friendPair(inviterId, inviteeId) } }),
      db.groupMember.findUnique({ where: { groupId_userId: { groupId, userId: inviteeId } } }),
      db.groupJoinRequest.findFirst({
        where: { groupId, userId: inviteeId, status: JoinRequestStatus.PENDING },
      }),
    ]);
    const outcome = inviteOutcome({
      inviterIsOwner,
      isFriend: Boolean(friendship),
      isMember: Boolean(membership),
      hasPendingRequest: Boolean(pending),
    });
    results[inviteeId] = outcome;

    if (outcome === "added") {
      await db.$transaction([
        db.groupMember.create({ data: { groupId, userId: inviteeId } }),
        // Owner's own invitation also settles anyone else's pending request.
        db.groupJoinRequest.updateMany({
          where: { groupId, userId: inviteeId, status: JoinRequestStatus.PENDING },
          data: {
            status: JoinRequestStatus.APPROVED,
            decidedAt: new Date(),
            decidedById: inviterId,
          },
        }),
      ]);
      await postSystemMessage(
        groupId,
        `${await nameOf(inviterId)} 邀请 ${await nameOf(inviteeId)} 加入了群`,
        [inviterId, inviteeId],
      );
    } else if (outcome === "requested") {
      await db.groupJoinRequest.create({
        data: { groupId, userId: inviteeId, invitedById: inviterId },
      });
      await notify("JOIN_REQUEST", [group.ownerId], {
        title: `「${group.name}」有新的入群请求`,
        body: `${await nameOf(inviterId)} 想邀请 ${await nameOf(inviteeId)} 加入「${group.name}」，需要你审批。`,
        path: `/groups/${groupId}`,
      });
    }
  }
  return results;
}

export async function decideJoinRequest(
  groupId: string,
  ownerId: string,
  requestId: string,
  approve: boolean,
): Promise<void> {
  await requireOwner(groupId, ownerId);
  const req = await db.groupJoinRequest.findFirst({
    where: { id: requestId, groupId, status: JoinRequestStatus.PENDING },
  });
  if (!req) throw new GroupError("申请不存在或已处理");

  const decided = {
    status: approve ? JoinRequestStatus.APPROVED : JoinRequestStatus.REJECTED,
    decidedAt: new Date(),
    decidedById: ownerId,
  };
  await db.$transaction(async (tx) => {
    await tx.groupJoinRequest.update({ where: { id: req.id }, data: decided });
    if (approve) {
      await tx.groupMember.upsert({
        where: { groupId_userId: { groupId, userId: req.userId } },
        create: { groupId, userId: req.userId },
        update: {},
      });
    }
  });
  if (approve) {
    await postSystemMessage(
      groupId,
      `${await nameOf(req.userId)} 加入了群（由 ${await nameOf(req.invitedById)} 邀请）`,
      [ownerId, req.userId],
    );
  }
}

/** The member who invited can withdraw their own pending request. */
export async function cancelJoinRequest(groupId: string, userId: string, requestId: string) {
  await requireMember(groupId, userId);
  const { count } = await db.groupJoinRequest.updateMany({
    where: { id: requestId, groupId, invitedById: userId, status: JoinRequestStatus.PENDING },
    data: { status: JoinRequestStatus.CANCELLED, decidedAt: new Date(), decidedById: userId },
  });
  if (count !== 1) throw new GroupError("申请不存在或已处理");
}

export async function removeMember(groupId: string, ownerId: string, memberId: string) {
  await requireOwner(groupId, ownerId);
  if (memberId === ownerId) throw new GroupError("群主不能移除自己");
  const { count } = await db.groupMember.deleteMany({ where: { groupId, userId: memberId } });
  if (count)
    await postSystemMessage(groupId, `${await nameOf(memberId)} 被群主移出了群`, [ownerId]);
}

export async function leaveGroup(groupId: string, userId: string) {
  const group = await requireMember(groupId, userId);
  if (group.ownerId === userId) throw new GroupError("群主需要先转让群主才能退群");
  await db.groupMember.deleteMany({ where: { groupId, userId } });
  await postSystemMessage(groupId, `${await nameOf(userId)} 退出了群`);
}

export async function transferOwnership(groupId: string, ownerId: string, newOwnerId: string) {
  await requireOwner(groupId, ownerId);
  const member = await db.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId: newOwnerId } },
  });
  if (!member || newOwnerId === ownerId) throw new GroupError("只能转让给其他群成员");
  await db.group.update({ where: { id: groupId }, data: { ownerId: newOwnerId } });
  await postSystemMessage(
    groupId,
    `${await nameOf(ownerId)} 把群主转让给了 ${await nameOf(newOwnerId)}`,
    [ownerId],
  );
}

export async function updateGroupInfo(
  groupId: string,
  ownerId: string,
  info: { name: string; description: string },
) {
  const group = await requireOwner(groupId, ownerId);
  await db.group.update({ where: { id: groupId }, data: info });
  if (group.name !== info.name) {
    await postSystemMessage(groupId, `${await nameOf(ownerId)} 把群名改为「${info.name}」`, [
      ownerId,
    ]);
  }
}

export async function dissolveGroup(groupId: string, ownerId: string) {
  await requireOwner(groupId, ownerId);
  await db.$transaction([
    db.group.update({ where: { id: groupId }, data: { dissolvedAt: new Date() } }),
    db.groupJoinRequest.updateMany({
      where: { groupId, status: JoinRequestStatus.PENDING },
      data: { status: JoinRequestStatus.CANCELLED, decidedAt: new Date(), decidedById: ownerId },
    }),
  ]);
}

/** The user's group with the newest chat message (or newest membership), for the home page. */
export async function latestActiveGroupId(userId: string): Promise<string | null> {
  const mine = { dissolvedAt: null, members: { some: { userId } } };
  const message = await db.chatMessage.findFirst({
    where: { group: mine },
    orderBy: { createdAt: "desc" },
    select: { groupId: true },
  });
  if (message) return message.groupId;
  const membership = await db.groupMember.findFirst({
    where: { userId, group: { dissolvedAt: null } },
    orderBy: { joinedAt: "desc" },
    select: { groupId: true },
  });
  return membership?.groupId ?? null;
}

const channelLabel = (c: { name: string; server: string }) => `${c.server} · #${c.name}`;

/** Text channels the bot can post in, for the owner's picker. */
export async function discordChannelOptions(): Promise<
  { options: { id: string; label: string }[] } | { error: string }
> {
  const e = env();
  if (!e.DISCORD_BOT_TOKEN) return { error: "站点尚未配置 Discord 机器人。" };
  try {
    const channels = await listTextChannels({
      apiUrl: e.DISCORD_API_URL,
      token: e.DISCORD_BOT_TOKEN,
    });
    if (channels.length === 0) return { error: "机器人还没有加入任何 Discord 服务器。" };
    return { options: channels.map((c) => ({ id: c.id, label: channelLabel(c) })) };
  } catch (err) {
    console.error("[discord] listing channels failed:", err);
    return { error: "暂时无法读取 Discord 频道列表，请稍后再试。" };
  }
}

/**
 * Links the group's vote notifications to a Discord channel (null unlinks).
 * The bot posts a confirmation first, so a channel it can't write to is refused.
 */
export async function setDiscordChannel(
  groupId: string,
  ownerId: string,
  channelId: string | null,
) {
  const group = await requireOwner(groupId, ownerId);
  if (!channelId) {
    if (!group.discordChannelId) return;
    await db.group.update({
      where: { id: groupId },
      data: { discordChannelId: null, discordChannelLabel: null },
    });
    await postSystemMessage(groupId, `${await nameOf(ownerId)} 取消了 Discord 频道通知`, [ownerId]);
    return;
  }
  const e = env();
  if (!e.DISCORD_BOT_TOKEN) throw new GroupError("站点尚未配置 Discord 机器人");
  const opts = { apiUrl: e.DISCORD_API_URL, token: e.DISCORD_BOT_TOKEN };
  const channel = (await listTextChannels(opts)).find((c) => c.id === channelId);
  if (!channel) throw new GroupError("找不到这个频道，机器人可能已不在那个服务器");
  try {
    await postToChannel(opts, channel.id, {
      content: `🎮 已连接 Game Vote 群「${group.name}」：新投票和投票提示会发到这个频道。`,
    });
  } catch (err) {
    throw new GroupError(
      `无法在 #${channel.name} 发消息：${err instanceof Error ? err.message : err}`,
    );
  }
  await db.group.update({
    where: { id: groupId },
    data: { discordChannelId: channel.id, discordChannelLabel: channelLabel(channel) },
  });
  await postSystemMessage(
    groupId,
    `${await nameOf(ownerId)} 把投票通知连接到了 Discord 频道 ${channelLabel(channel)}`,
    [ownerId],
  );
}

/** The latest channel post for the group, for the owner to see whether it went out. */
export function lastChannelPost(groupId: string) {
  return db.notification.findFirst({
    where: { groupId, channel: "DISCORD_CHANNEL" },
    orderBy: { createdAt: "desc" },
    select: { title: true, status: true, lastError: true, createdAt: true },
  });
}
