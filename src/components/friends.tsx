"use client";

import { useActionState, useState, useTransition } from "react";
import type { FormState } from "@/lib/auth/actions";
import {
  acceptInvite,
  addFriendByCode,
  addFriendById,
  cancelFriendRequest,
  createInviteLink,
  respondRequest,
  revokeInviteLink,
  unfriend,
} from "@/lib/friends/actions";
import { copyText } from "@/lib/clipboard";
import { Alert, Button, Field } from "./ui";
import { useT } from "./i18n";

function Status({ state }: { state: FormState }) {
  if (state?.error) return <Alert kind="error">{state.error}</Alert>;
  if (state?.ok) return <Alert kind="ok">{state.ok}</Alert>;
  return null;
}

export function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  return (
    <Button
      type="button"
      variant="secondary"
      className="px-3 py-1.5"
      onClick={async () => {
        setResult((await copyText(text)) ? "copied" : "failed");
        setTimeout(() => setResult(null), 2000);
      }}
    >
      {result === "copied"
        ? t("已复制")
        : result === "failed"
          ? t("复制失败，请手动复制")
          : t("复制")}
    </Button>
  );
}

export function AddFriendForm() {
  const t = useT();
  const [state, action, pending] = useActionState(addFriendByCode, undefined);
  return (
    <form action={action} className="space-y-3">
      <Status state={state} />
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label={t("好友码")} name="code" placeholder={t("用户名#1234")} required />
        </div>
        <Button disabled={pending}>{t("发送申请")}</Button>
      </div>
    </form>
  );
}

export function RequestActions({ requestId }: { requestId: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-2">
      <Button
        className="px-3 py-1.5"
        disabled={pending}
        onClick={() => start(() => respondRequest(requestId, true))}
      >
        {t("接受")}
      </Button>
      <Button
        variant="secondary"
        className="px-3 py-1.5"
        disabled={pending}
        onClick={() => start(() => respondRequest(requestId, false))}
      >
        {t("拒绝")}
      </Button>
    </div>
  );
}

export function CancelRequestButton({ requestId }: { requestId: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      className="px-3 py-1.5"
      disabled={pending}
      onClick={() => start(() => cancelFriendRequest(requestId))}
    >
      {t("撤回")}
    </Button>
  );
}

export function RemoveFriendButton({ friendId, name }: { friendId: string; name: string }) {
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      className="px-3 py-1.5 text-xs"
      disabled={pending}
      onClick={() => {
        if (confirm(t("确定删除好友 {name}？", { name }))) start(() => unfriend(friendId));
      }}
    >
      {t("删除")}
    </Button>
  );
}

export function SuggestionAddButton({ userId }: { userId: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(() => addFriendById(userId), undefined);
  if (state?.ok) return <span className="text-sm text-emerald-600">{t("已发送")}</span>;
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button className="px-3 py-1.5" disabled={pending}>
        {t("加好友")}
      </Button>
      {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

const selectClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

export function CreateInviteForm() {
  const t = useT();
  const [state, action, pending] = useActionState(createInviteLink, undefined);
  return (
    <form action={action} className="space-y-3">
      <Status state={state} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("有效期")}</span>
          <select name="expiry" defaultValue="7d" className={selectClass}>
            <option value="1d">{t("1 天")}</option>
            <option value="7d">{t("7 天")}</option>
            <option value="30d">{t("30 天")}</option>
            <option value="never">{t("永久")}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("可用次数")}</span>
          <select name="maxUses" defaultValue="5" className={selectClass}>
            <option value="1">{t("1 次")}</option>
            <option value="5">{t("5 次")}</option>
            <option value="20">{t("20 次")}</option>
            <option value="unlimited">{t("不限")}</option>
          </select>
        </label>
        <Button className="col-span-2 sm:col-span-1" disabled={pending}>
          {t("生成邀请链接")}
        </Button>
      </div>
    </form>
  );
}

export function InviteLinkRow({
  inviteId,
  url,
  qrSvg,
  summary,
  active,
}: {
  inviteId: string;
  url: string;
  qrSvg: string;
  summary: string;
  active: boolean;
}) {
  const t = useT();
  const [showQr, setShowQr] = useState(false);
  const [pending, start] = useTransition();
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <code
          className={`min-w-0 flex-1 truncate rounded bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800 ${active ? "" : "line-through opacity-60"}`}
        >
          {url}
        </code>
        {active && <CopyButton text={url} />}
        {active && (
          <Button
            type="button"
            variant="secondary"
            className="px-3 py-1.5"
            onClick={() => setShowQr((v) => !v)}
          >
            {t("二维码")}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          className="px-3 py-1.5"
          disabled={pending}
          onClick={() => start(() => revokeInviteLink(inviteId))}
        >
          {active ? t("作废") : t("移除")}
        </Button>
      </div>
      <p className="text-xs text-zinc-500">{summary}</p>
      {showQr && (
        <div
          role="img"
          aria-label={t("邀请链接二维码")}
          className="w-48 rounded-lg bg-white p-2"
          // SVG generated server-side by the qrcode library from our own URL.
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
      )}
    </li>
  );
}

export function AcceptInviteButton({ code }: { code: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(() => acceptInvite(code), undefined);
  return (
    <form action={action} className="space-y-3">
      <Status state={state} />
      <Button className="w-full" disabled={pending}>
        {t("接受邀请，成为好友")}
      </Button>
    </form>
  );
}
