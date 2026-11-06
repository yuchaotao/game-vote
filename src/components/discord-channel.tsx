"use client";

import type { NotificationStatus } from "@prisma/client";
import { useActionState } from "react";
import type { FormState } from "@/lib/auth/actions";
import { setDiscordChannelAction } from "@/lib/groups/actions";
import { LocalDate } from "./games";
import { Alert, Button } from "./ui";
import { useT } from "./i18n";
import { msg } from "@/lib/i18n";

const STATUS_TEXT: Record<NotificationStatus, string> = {
  PENDING: msg("等待发送"),
  SENDING: msg("发送中"),
  SENT: msg("已发送"),
  FAILED: msg("发送失败"),
};

function Status({ state }: { state: FormState }) {
  if (state?.error) return <Alert kind="error">{state.error}</Alert>;
  if (state?.ok) return <Alert kind="ok">{state.ok}</Alert>;
  return null;
}

/** Owner picks the Discord channel that gets this group's vote notifications. */
export function DiscordChannelForm({
  groupId,
  current,
  options,
  unavailable,
  last,
}: {
  groupId: string;
  current: { id: string; label: string } | null;
  /** Text channels the bot can see, or null when they couldn't be listed. */
  options: { id: string; label: string }[] | null;
  /** Why channels can't be picked (bot not configured, Discord unreachable). */
  unavailable?: string;
  last: {
    title: string;
    status: NotificationStatus;
    lastError: string | null;
    createdAt: Date;
  } | null;
}) {
  const t = useT();
  const [state, action, pending] = useActionState(
    setDiscordChannelAction.bind(null, groupId),
    undefined,
  );
  // Keep the current channel selectable even if the bot can't list it any more.
  const choices =
    current && !options?.some((o) => o.id === current.id)
      ? [current, ...(options ?? [])]
      : (options ?? []);

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500">
        {t(
          "新投票和新投票提示会发到这个频道，并 @ 已绑定 Discord、开了这类通知的成员（他们就不会再单独收到私信）。",
        )}
      </p>
      <Status state={state} />
      {unavailable && <Alert kind="info">{unavailable}</Alert>}
      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-sm font-medium">{t("Discord 频道")}</span>
          <select
            name="channelId"
            defaultValue={current?.id ?? ""}
            disabled={!options && !current}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="">{t("不发到频道（成员各自收私信）")}</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={pending || (!options && !current)}>
          {pending ? t("连接中…") : t("保存频道")}
        </Button>
      </form>
      {current && last && (
        <p className="text-xs text-zinc-500">
          {t("最近一条：")}
          {last.title} · <LocalDate value={last.createdAt} /> ·{" "}
          <span className={last.status === "FAILED" ? "text-red-600 dark:text-red-400" : ""}>
            {t(STATUS_TEXT[last.status])}
            {last.status !== "SENT" && last.lastError && `（${last.lastError}）`}
          </span>
        </p>
      )}
    </div>
  );
}
