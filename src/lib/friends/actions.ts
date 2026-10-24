"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/auth/actions";
import { rateLimit } from "@/lib/auth/rate-limit";
import { requireUser } from "@/lib/auth/session";
import {
  INVITE_EXPIRY_OPTIONS,
  INVITE_MAX_USES_OPTIONS,
  parseMaxUses,
  type InviteExpiry,
} from "./rules";
import {
  cancelRequest,
  createInvite,
  redeemInvite,
  removeFriend,
  respondToRequest,
  revokeInvite,
  sendRequestByCode,
  sendRequestById,
  type SendResult,
} from "./service";

function sendMessage(result: SendResult): FormState {
  switch (result.kind) {
    case "sent":
      return { ok: `已向 ${result.to.displayName} 发送好友申请` };
    case "accepted":
      return { ok: `${result.to.displayName} 也向你发过申请，你们已成为好友` };
    case "already-pending":
      return { error: "已经发送过申请，等待对方确认" };
    case "already-friends":
      return { error: "你们已经是好友了" };
    case "self":
      return { error: "不能添加自己为好友" };
    case "not-found":
      return { error: "找不到这个好友码，格式应为 用户名#1234" };
  }
}

async function guardRequests(userId: string): Promise<FormState | null> {
  return (await rateLimit(`friend-request:${userId}`, 30, 3600))
    ? null
    : { error: "操作过于频繁，请稍后再试" };
}

export async function addFriendByCode(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const limited = await guardRequests(user.id);
  if (limited) return limited;
  const result = await sendRequestByCode(user.id, String(form.get("code") ?? ""));
  revalidatePath("/friends");
  return sendMessage(result);
}

export async function addFriendById(friendId: string): Promise<FormState> {
  const user = await requireUser();
  const limited = await guardRequests(user.id);
  if (limited) return limited;
  const result = await sendRequestById(user.id, friendId);
  revalidatePath("/friends");
  return sendMessage(result);
}

export async function respondRequest(requestId: string, accept: boolean): Promise<void> {
  const user = await requireUser();
  await respondToRequest(user.id, requestId, accept);
  revalidatePath("/", "layout");
}

export async function cancelFriendRequest(requestId: string): Promise<void> {
  const user = await requireUser();
  await cancelRequest(user.id, requestId);
  revalidatePath("/friends");
}

export async function unfriend(friendId: string): Promise<void> {
  const user = await requireUser();
  await removeFriend(user.id, friendId);
  revalidatePath("/friends");
}

export async function createInviteLink(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const expiry = String(form.get("expiry")) as InviteExpiry;
  const maxUses = String(form.get("maxUses"));
  if (!(expiry in INVITE_EXPIRY_OPTIONS) || !INVITE_MAX_USES_OPTIONS.includes(maxUses as never)) {
    return { error: "参数无效" };
  }
  if (!(await rateLimit(`invite-create:${user.id}`, 20, 3600))) {
    return { error: "创建过于频繁，请稍后再试" };
  }
  await createInvite(user.id, {
    expiresInMs: INVITE_EXPIRY_OPTIONS[expiry],
    maxUses: parseMaxUses(maxUses),
  });
  revalidatePath("/friends");
  return { ok: "邀请链接已创建" };
}

export async function revokeInviteLink(inviteId: string): Promise<void> {
  const user = await requireUser();
  await revokeInvite(user.id, inviteId);
  revalidatePath("/friends");
}

export async function acceptInvite(code: string): Promise<FormState> {
  const user = await requireUser();
  const result = await redeemInvite(user.id, code);
  switch (result.kind) {
    case "befriended":
    case "already-friends":
      revalidatePath("/friends");
      redirect(`/friends?added=${encodeURIComponent(result.creator.displayName)}`);
    case "own-invite":
      return { error: "这是你自己的邀请链接" };
    case "invalid":
      return { error: "邀请链接已失效" };
  }
}
