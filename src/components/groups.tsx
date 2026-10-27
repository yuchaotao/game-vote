"use client";

import { useActionState, useState, useTransition } from "react";
import type { FormState } from "@/lib/auth/actions";
import type { PublicUser } from "@/lib/friends/service";
import {
  cancelJoinRequestAction,
  createGroupAction,
  decideJoinRequestAction,
  dissolveGroupAction,
  inviteToGroupAction,
  leaveGroupAction,
  removeMemberAction,
  transferOwnershipAction,
  updateGroupInfoAction,
} from "@/lib/groups/actions";
import { Alert, Avatar, Button, Field } from "./ui";

function Status({ state }: { state: FormState }) {
  if (state?.error) return <Alert kind="error">{state.error}</Alert>;
  if (state?.ok) return <Alert kind="ok">{state.ok}</Alert>;
  return null;
}

const textareaClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950";

/** One-click server action with optional confirmation and inline error. */
function ActionButton({
  action,
  children,
  variant = "secondary",
  confirmText,
  className = "px-3 py-1.5",
}: {
  action: () => Promise<FormState>;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  confirmText?: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        variant={variant}
        className={className}
        disabled={pending}
        onClick={() => {
          if (confirmText && !confirm(confirmText)) return;
          start(async () => setError((await action())?.error));
        }}
      >
        {children}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

export function CreateGroupForm() {
  const [state, action, pending] = useActionState(createGroupAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <Status state={state} />
      <Field label="群名" name="name" maxLength={40} required />
      <label className="block">
        <span className="mb-1 block text-sm font-medium">简介（可选）</span>
        <textarea name="description" rows={2} maxLength={500} className={textareaClass} />
      </label>
      <Button disabled={pending}>创建群</Button>
    </form>
  );
}

export function GroupInfoForm({
  groupId,
  name,
  description,
}: {
  groupId: string;
  name: string;
  description: string;
}) {
  const [state, action, pending] = useActionState(
    updateGroupInfoAction.bind(null, groupId),
    undefined,
  );
  return (
    <form action={action} className="space-y-3">
      <Status state={state} />
      <Field label="群名" name="name" defaultValue={name} maxLength={40} required />
      <label className="block">
        <span className="mb-1 block text-sm font-medium">简介</span>
        <textarea
          name="description"
          rows={3}
          maxLength={500}
          defaultValue={description}
          className={textareaClass}
        />
      </label>
      <Button disabled={pending}>保存</Button>
    </form>
  );
}

export function InviteFriendsForm({
  groupId,
  friends,
  isOwner,
}: {
  groupId: string;
  friends: PublicUser[];
  isOwner: boolean;
}) {
  const [state, action, pending] = useActionState(
    inviteToGroupAction.bind(null, groupId),
    undefined,
  );
  return (
    <form action={action} className="space-y-3">
      <Status state={state} />
      {friends.length === 0 ? (
        <p className="text-sm text-zinc-500">没有可以邀请的好友（都已在群里或正在等待审批）。</p>
      ) : (
        <>
          <ul className="grid gap-2 sm:grid-cols-2">
            {friends.map((f) => (
              <li key={f.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 hover:bg-zinc-50 has-checked:border-indigo-500 has-checked:bg-indigo-50 dark:border-zinc-800 dark:hover:bg-zinc-800 dark:has-checked:bg-indigo-950">
                  <input type="checkbox" name="userId" value={f.id} className="accent-indigo-600" />
                  <Avatar src={f.avatarUrl} name={f.displayName} size={28} />
                  <span className="truncate text-sm">{f.displayName}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3">
            <Button disabled={pending}>邀请</Button>
            <span className="text-xs text-zinc-500">
              {isOwner ? "你是群主，邀请的好友会直接入群。" : "邀请需要群主确认后才会入群。"}
            </span>
          </div>
        </>
      )}
    </form>
  );
}

export function JoinRequestActions({ groupId, requestId }: { groupId: string; requestId: string }) {
  return (
    <span className="flex gap-2">
      <ActionButton
        variant="primary"
        action={() => decideJoinRequestAction(groupId, requestId, true)}
      >
        同意
      </ActionButton>
      <ActionButton action={() => decideJoinRequestAction(groupId, requestId, false)}>
        拒绝
      </ActionButton>
    </span>
  );
}

export function CancelJoinRequestButton({
  groupId,
  requestId,
}: {
  groupId: string;
  requestId: string;
}) {
  return (
    <ActionButton variant="ghost" action={() => cancelJoinRequestAction(groupId, requestId)}>
      撤回
    </ActionButton>
  );
}

export function MemberOwnerActions({
  groupId,
  memberId,
  name,
}: {
  groupId: string;
  memberId: string;
  name: string;
}) {
  return (
    <span className="flex gap-1">
      <ActionButton
        variant="ghost"
        className="px-2 py-1 text-xs"
        confirmText={`确定把群主转让给 ${name}？转让后你将成为普通成员。`}
        action={() => transferOwnershipAction(groupId, memberId)}
      >
        设为群主
      </ActionButton>
      <ActionButton
        variant="ghost"
        className="px-2 py-1 text-xs"
        confirmText={`确定将 ${name} 移出群？`}
        action={() => removeMemberAction(groupId, memberId)}
      >
        移出
      </ActionButton>
    </span>
  );
}

export function LeaveGroupButton({ groupId }: { groupId: string }) {
  return (
    <ActionButton confirmText="确定退出这个群？" action={() => leaveGroupAction(groupId)}>
      退出群
    </ActionButton>
  );
}

export function DissolveGroupButton({ groupId, name }: { groupId: string; name: string }) {
  return (
    <ActionButton
      confirmText={`确定解散「${name}」？所有成员将无法再访问这个群。`}
      action={() => dissolveGroupAction(groupId)}
    >
      解散群
    </ActionButton>
  );
}
