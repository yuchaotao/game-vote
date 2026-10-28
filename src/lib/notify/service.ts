import {
  NotificationChannel,
  NotificationStatus,
  type Notification,
  type NotificationEvent,
} from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import { QUEUE, queue } from "@/lib/queues";
import { absoluteUrl } from "@/lib/urls";
import { sendDiscordDm } from "./discord-bot";
import {
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
): Record<NotificationChannel, boolean> {
  return {
    EMAIL: Boolean(user.emailVerifiedAt),
    DISCORD: Boolean(e.DISCORD_BOT_TOKEN) && user.accounts.some((a) => a.provider === "discord"),
  };
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
    const users = await db.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: {
        id: true,
        emailVerifiedAt: true,
        accounts: { where: { provider: "discord" }, select: { provider: true } },
        notificationPreferences: { where: { event } },
      },
    });
    const url = absoluteUrl(content.path);
    const rows = users.flatMap((u) => {
      const prefs = effectivePreferences(u.notificationPreferences);
      const can = reachable(u);
      return CHANNELS.filter((c) => can[c] && prefs[prefKey(event, c)]).map((channel) => ({
        userId: u.id,
        event,
        channel,
        title: content.title,
        body: content.body,
        url,
      }));
    });
    if (rows.length === 0) return 0;
    await db.notification.createMany({ data: rows });
    // Send now rather than at the next scheduled sweep.
    await queue(QUEUE.notify).add("send-notifications", null, {
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return rows.length;
  } catch (err) {
    console.error(`[notify] ${event} failed to queue:`, err);
    return 0;
  }
}

async function deliver(n: Notification) {
  const e = env();
  if (n.channel === NotificationChannel.EMAIL) {
    const user = await db.user.findUniqueOrThrow({
      where: { id: n.userId },
      select: { email: true, emailVerifiedAt: true },
    });
    if (!user.email || !user.emailVerifiedAt) throw new PermanentDeliveryError("邮箱未验证");
    await sendMail({ to: user.email, ...renderEmail(n, absoluteUrl("/settings#notifications")) });
    return;
  }
  const account = await db.account.findUnique({
    where: { userId_provider: { userId: n.userId, provider: "discord" } },
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
