import type { NotificationChannel, NotificationEvent } from "@prisma/client";

// Pure notification rules: which events exist, defaults, retries and message rendering.
// Type-only Prisma imports: the settings form uses this module in the browser.

/** Channels a user chooses per event (a group's Discord channel is set on the group). */
export type UserChannel = Exclude<NotificationChannel, "DISCORD_CHANNEL">;

export const CHANNELS: readonly UserChannel[] = ["EMAIL", "DISCORD"];

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  EMAIL: "邮件",
  DISCORD: "Discord 私信",
  DISCORD_CHANNEL: "Discord 频道",
};

type EventInfo = {
  label: string;
  hint: string;
  defaults: Record<UserChannel, boolean>;
};

// Requests wait on you, so they also go by email; vote news is chattier and
// time-sensitive, so it only goes to Discord by default.
export const EVENTS: Record<NotificationEvent, EventInfo> = {
  NEW_ROUND: {
    label: "新投票",
    hint: "群里有人发起了投票",
    defaults: { EMAIL: false, DISCORD: true },
  },
  VOTE_PROMPT: {
    label: "新投票提示",
    hint: "大家正在一起玩投票中领先的游戏，问要不要结束投票",
    defaults: { EMAIL: false, DISCORD: true },
  },
  JOIN_REQUEST: {
    label: "入群请求",
    hint: "你的群有待审批的入群请求",
    defaults: { EMAIL: true, DISCORD: true },
  },
  FRIEND_REQUEST: {
    label: "好友申请",
    hint: "有人想加你为好友",
    defaults: { EMAIL: true, DISCORD: true },
  },
};

export const EVENT_ORDER = Object.keys(EVENTS) as NotificationEvent[];

export const prefKey = (event: NotificationEvent, channel: UserChannel) => `${event}:${channel}`;

/** A user's effective choices: stored rows over the defaults. */
export function effectivePreferences(
  stored: { event: NotificationEvent; channel: NotificationChannel; enabled: boolean }[],
): Record<string, boolean> {
  const prefs: Record<string, boolean> = {};
  for (const event of EVENT_ORDER) {
    for (const channel of CHANNELS)
      prefs[prefKey(event, channel)] = EVENTS[event].defaults[channel];
  }
  // Stored rows only ever hold user channels.
  for (const s of stored) prefs[prefKey(s.event, s.channel as UserChannel)] = s.enabled;
  return prefs;
}

export const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

/** Wait before the next try after `attempts` failed ones (1-based). */
export function retryDelay(attempts: number): number {
  return RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length) - 1];
}

/** A try that started this long ago without finishing is assumed dead (worker restart). */
export const STALE_SENDING_MS = 10 * 60_000;

/** A failure that retrying will not fix. */
export class PermanentDeliveryError extends Error {}

export type Message = { title: string; body: string; url: string };

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderEmail(m: Message, settingsUrl: string) {
  const text = `${m.body}\n\n打开：${m.url}\n\n——\n在设置中管理通知：${settingsUrl}`;
  const html = `<!doctype html>
<html lang="zh-CN"><body style="margin:0;background:#f4f4f5;font-family:-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:#18181b">
<div style="max-width:520px;margin:24px auto;background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:24px">
<p style="margin:0 0 4px;font-size:13px;color:#6366f1;font-weight:600">Game Vote</p>
<h1 style="margin:0 0 12px;font-size:18px">${escapeHtml(m.title)}</h1>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6">${escapeHtml(m.body)}</p>
<a href="${escapeHtml(m.url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px">打开 Game Vote</a>
</div>
<p style="text-align:center;font-size:12px;color:#71717a">不想收到这类邮件？<a href="${escapeHtml(settingsUrl)}" style="color:#71717a">在设置中管理通知</a></p>
</body></html>`;
  return { subject: `Game Vote：${m.title}`, text, html };
}

/** Discord message body: an embed linking back to the site. */
export function discordPayload(m: Message) {
  return {
    embeds: [
      {
        title: m.title.slice(0, 256),
        description: m.body.slice(0, 4000),
        url: m.url,
        color: 0x4f46e5,
        footer: { text: "Game Vote · 在网站设置中管理通知" },
      },
    ],
  };
}

/** A group channel post: the embed plus @mentions, and only those users may be pinged. */
export function channelPayload(m: Message, mentionIds: string[]) {
  return {
    ...(mentionIds.length > 0 && { content: mentionIds.map((id) => `<@${id}>`).join(" ") }),
    ...discordPayload(m),
    allowed_mentions: { users: mentionIds },
  };
}
