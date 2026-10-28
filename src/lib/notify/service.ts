import {
  NotificationChannel,
  NotificationStatus,
  type Notification,
  type NotificationEvent,
  type Prisma,
} from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import { QUEUE, queue } from "@/lib/queues";
import { absoluteUrl } from "@/lib/urls";
import { postToChannel, sendDiscordDm } from "./discord-bot";
import {
  channelPayload,
  CHANNELS,
  discordPayload,
  effectivePreferences,
  EVENT_ORDER,
  MAX_ATTEMPTS,
  PermanentDeliveryError,
  prefKey,
  renderEmail,
  retryDelay,
  STALE_SENDING_MS,
  type UserChannel,
} from "./rules";

// Notifications (#11): events queue one row per recipient and channel; the
// worker's send-notifications job delivers them and retries failures.

export type NotificationContent = {
  title: string;
  body: string;
  /** App path the notification links to, e.g. /friends. */
  path: string;
};

/** Which channels can reach a user right now. */
function reachable(
  user: { emailVerifiedAt: Date | null; accounts: { provider: string }[] },
  e = env(),
): Record<UserChannel, boolean> {
  return {
    EMAIL: Boolean(user.emailVerifiedAt),
    DISCORD: Boolean(e.DISCORD_BOT_TOKEN) && user.accounts.some((a) => a.provider === "discord"),
  };
}

function loadRecipients(event: NotificationEvent, userIds: string[]) {
  return db.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: {
      id: true,
      emailVerifiedAt: true,
      accounts: {
        where: { provider: "discord" },
        select: { provider: true, providerAccountId: true },
      },
      notificationPreferences: { where: { event } },
    },
  });
}

/** The channels each user has on for `event` and can be reached by. */
function wanted(event: NotificationEvent, users: Awaited<ReturnType<typeof loadRecipients>>) {
  return users.map((user) => {
    const prefs = effectivePreferences(user.notificationPreferences);
    const can = reachable(user);
    return { user, channels: CHANNELS.filter((c) => can[c] && prefs[prefKey(event, c)]) };
  });
}

async function enqueue(rows: Prisma.NotificationCreateManyInput[]) {
  if (rows.length === 0) return 0;
  await db.notification.createMany({ data: rows });
  // Send now rather than at the next scheduled sweep.
  await queue(QUEUE.notify).add("send-notifications", null, {
    removeOnComplete: true,
    removeOnFail: 100,
  });
  return rows.length;
}

/**
 * Queues `event` for each user, on the channels they have on and can be reached
 * by. Never throws: a notification problem must not break the action behind it.
 */
export async function notify(
  event: NotificationEvent,
  userIds: string[],
  content: NotificationContent,
): Promise<number> {
  try {
    const url = absoluteUrl(content.path);
    const rows = wanted(event, await loadRecipients(event, userIds)).flatMap(({ user, channels }) =>
      channels.map((channel) => ({
        userId: user.id,
        event,
        channel,
        title: content.title,
        body: content.body,
        url,
      })),
    );
    return await enqueue(rows);
  } catch (err) {
    console.error(`[notify] ${event} failed to queue:`, err);
    return 0;
  }
}

/**
 * A group event for every member but `exceptUserId`. When the group has a
 * Discord channel (#38), Discord goes there as one post @mentioning the members
 * who want Discord for this event, instead of DMs; email stays per member.
 */
export async function notifyGroup(
  event: NotificationEvent,
  groupId: string,
  exceptUserId: string | null,
  content: (groupName: string) => NotificationContent,
): Promise<number> {
  try {
    const group = await db.group.findUniqueOrThrow({
      where: { id: groupId },
      select: { name: true, discordChannelId: true, members: { select: { userId: true } } },
    });
    const ids = group.members.map((m) => m.userId).filter((id) => id !== exceptUserId);
    const c = content(group.name);
    if (!group.discordChannelId || !env().DISCORD_BOT_TOKEN) return await notify(event, ids, c);

    const base = { event, title: c.title, body: c.body, url: absoluteUrl(c.path) };
    const recipients = wanted(event, await loadRecipients(event, ids));
    const mentions = recipients
      .filter((r) => r.channels.includes("DISCORD"))
      .map((r) => r.user.accounts[0].providerAccountId);
    return await enqueue([
      ...recipients
        .filter((r) => r.channels.includes("EMAIL"))
        .map((r) => ({ ...base, userId: r.user.id, channel: NotificationChannel.EMAIL })),
      { ...base, groupId, channel: NotificationChannel.DISCORD_CHANNEL, mentions },
    ]);
  } catch (err) {
    console.error(`[notify] ${event} for group ${groupId} failed to queue:`, err);
    return 0;
  }
}

async function deliver(n: Notification) {
  const e = env();
  if (n.channel === NotificationChannel.DISCORD_CHANNEL) {
    const group = n.groupId
      ? await db.group.findUnique({ where: { id: n.groupId }, select: { discordChannelId: true } })
      : null;
    if (!group?.discordChannelId) throw new PermanentDeliveryError("群已取消 Discord 频道通知");
    if (!e.DISCORD_BOT_TOKEN) throw new PermanentDeliveryError("站点未配置 Discord 机器人");
    await postToChannel(
      { apiUrl: e.DISCORD_API_URL, token: e.DISCORD_BOT_TOKEN },
      group.discordChannelId,
      channelPayload(n, n.mentions),
    );
    return;
  }
  const userId = n.userId;
  if (!userId) throw new PermanentDeliveryError("没有收件人");
  if (n.channel === NotificationChannel.EMAIL) {
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!user.email || !user.emailVerifiedAt) throw new PermanentDeliveryError("邮箱未验证");
    await sendMail({ to: user.email, ...renderEmail(n, absoluteUrl("/settings#notifications")) });
    return;
  }
  const account = await db.account.findUnique({
    where: { userId_provider: { userId, provider: "discord" } },
    select: { providerAccountId: true },
  });
  if (!account) throw new PermanentDeliveryError("已解绑 Discord");
  if (!e.DISCORD_BOT_TOKEN) throw new PermanentDeliveryError("站点未配置 Discord 机器人");
  await sendDiscordDm(
    { apiUrl: e.DISCORD_API_URL, token: e.DISCORD_BOT_TOKEN },
    account.providerAccountId,
    discordPayload(n),
  );
}

/** Delivers due notifications (worker job). */
export async function sendDueNotifications(now = new Date()) {
  const due = await db.notification.findMany({
    where: {
      OR: [
        { status: NotificationStatus.PENDING, nextAttemptAt: { lte: now } },
        // A try that never finished (worker restarted mid-send).
        {
          status: NotificationStatus.SENDING,
          nextAttemptAt: { lte: new Date(now.getTime() - STALE_SENDING_MS) },
        },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  let sent = 0;
  let failed = 0;
  let retrying = 0;
  for (const n of due) {
    // Claim it, so overlapping runs never send the same one twice.
    const attempts = n.attempts + 1;
    const { count } = await db.notification.updateMany({
      where: { id: n.id, status: n.status, nextAttemptAt: n.nextAttemptAt },
      data: { status: NotificationStatus.SENDING, attempts, nextAttemptAt: new Date() },
    });
    if (count === 0) continue;
    try {
      await deliver(n);
      await db.notification.update({
        where: { id: n.id },
        data: { status: NotificationStatus.SENT, sentAt: new Date(), lastError: null },
      });
      sent++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const giveUp = err instanceof PermanentDeliveryError || attempts >= MAX_ATTEMPTS;
      await db.notification.update({
        where: { id: n.id },
        data: giveUp
          ? { status: NotificationStatus.FAILED, lastError: message.slice(0, 500) }
          : {
              status: NotificationStatus.PENDING,
              lastError: message.slice(0, 500),
              nextAttemptAt: new Date(Date.now() + retryDelay(attempts)),
            },
      });
      if (giveUp) failed++;
      else retrying++;
    }
  }
  return { sent, failed, retrying };
}

/** Settings page: effective choices, what can reach the user, recent history. */
export async function notificationSettings(userId: string) {
  const [user, recent] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        emailVerifiedAt: true,
        accounts: { where: { provider: "discord" }, select: { provider: true } },
        notificationPreferences: true,
      },
    }),
    db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        channel: true,
        title: true,
        status: true,
        lastError: true,
        createdAt: true,
      },
    }),
  ]);
  return {
    prefs: effectivePreferences(user.notificationPreferences),
    email: Boolean(user.emailVerifiedAt),
    discordLinked: user.accounts.length > 0,
    discordBot: Boolean(env().DISCORD_BOT_TOKEN),
    recent,
  };
}

/** Saves every event × channel choice (the form always submits all of them). */
export async function savePreferences(userId: string, enabled: Set<string>) {
  await db.$transaction(
    EVENT_ORDER.flatMap((event) =>
      CHANNELS.map((channel) =>
        db.notificationPreference.upsert({
          where: { userId_event_channel: { userId, event, channel } },
          create: { userId, event, channel, enabled: enabled.has(prefKey(event, channel)) },
          update: { enabled: enabled.has(prefKey(event, channel)) },
        }),
      ),
    ),
  );
}
