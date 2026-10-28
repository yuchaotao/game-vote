"use client";

import type { NotificationChannel, NotificationStatus } from "@prisma/client";
import { useActionState } from "react";
import { saveNotificationPreferences } from "@/lib/notify/actions";
import {
  CHANNEL_LABEL,
  CHANNELS,
  EVENT_ORDER,
  EVENTS,
  prefKey,
  type UserChannel,
} from "@/lib/notify/rules";
import { LocalDate } from "./games";
import { Alert, Button } from "./ui";

const STATUS_TEXT: Record<NotificationStatus, string> = {
  PENDING: "等待发送",
  SENDING: "发送中",
  SENT: "已发送",
  FAILED: "发送失败",
};

/** Event × channel switches, why a channel can't deliver, and recent history. */
export function NotificationSettings({
  prefs,
  email,
  discordLinked,
  discordBot,
  recent,
}: {
  prefs: Record<string, boolean>;
  email: boolean;
  discordLinked: boolean;
  discordBot: boolean;
  recent: {
    id: string;
    channel: NotificationChannel;
    title: string;
    status: NotificationStatus;
    lastError: string | null;
    createdAt: Date;
  }[];
}) {
  const [state, action, pending] = useActionState(saveNotificationPreferences, undefined);
  const notes: Record<UserChannel, string | null> = {
    EMAIL: email ? null : "验证邮箱后才会发送邮件。",
    DISCORD: !discordBot
      ? "站点尚未配置 Discord 机器人，暂时不会发送。"
      : !discordLinked
        ? "绑定 Discord 后才会发送私信。"
        : "需要和 Game Vote 机器人在同一个 Discord 服务器里，才能收到私信。群绑定了 Discord 频道时，新投票和投票提示改为在频道里 @ 你。",
  };

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        {state?.ok && <Alert kind="ok">{state.ok}</Alert>}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500">
              <th className="py-2 font-medium">事件</th>
              {CHANNELS.map((c) => (
                <th key={c} className="w-24 py-2 text-center font-medium">
                  {CHANNEL_LABEL[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {EVENT_ORDER.map((event) => (
              <tr key={event}>
                <td className="py-2">
                  <p className="font-medium">{EVENTS[event].label}</p>
                  <p className="text-xs text-zinc-500">{EVENTS[event].hint}</p>
                </td>
                {CHANNELS.map((c) => (
                  <td key={c} className="py-2 text-center">
                    <input
                      type="checkbox"
                      name={prefKey(event, c)}
                      defaultChecked={prefs[prefKey(event, c)]}
                      aria-label={`${EVENTS[event].label} · ${CHANNEL_LABEL[c]}`}
                      className="size-4 accent-indigo-600"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {CHANNELS.some((c) => notes[c]) && (
          <ul className="space-y-1 text-xs text-zinc-500">
            {CHANNELS.filter((c) => notes[c]).map((c) => (
              <li key={c}>
                {CHANNEL_LABEL[c]}：{notes[c]}
              </li>
            ))}
          </ul>
        )}
        <Button disabled={pending}>保存通知设置</Button>
      </form>

      {recent.length > 0 && (
        <section aria-label="最近的通知" className="space-y-2">
          <h3 className="text-sm font-medium">最近的通知</h3>
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {recent.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate">{n.title}</p>
                  <p className="text-xs text-zinc-500">
                    {CHANNEL_LABEL[n.channel]} · <LocalDate value={n.createdAt} />
                    {n.status !== "SENT" && n.lastError && <> · {n.lastError}</>}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-xs ${
                    n.status === "FAILED"
                      ? "text-red-600 dark:text-red-400"
                      : n.status === "SENT"
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-zinc-500"
                  }`}
                >
                  {STATUS_TEXT[n.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
