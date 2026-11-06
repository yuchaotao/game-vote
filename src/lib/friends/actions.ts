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
import { getT } from "@/lib/i18n/server";

async function sendMessage(result: SendResult): Promise<FormState> {
  const t = await getT();
  switch (result.kind) {
    case "sent":
      return { ok: t("已向 {name} 发送好友申请", { name: result.to.displayName }) };
    case "accepted":
      return { ok: t("{name} 也向你发过申请，你们已成为好友", { name: result.to.displayName }) };
    case "already-pending":
      return { error: t("已经发送过申请，等待对方确认") };
    case "already-friends":
      return { error: t("你们已经是好友了") };
    case "self":
      return { error: t("不能添加自己为好友") };
    case "not-found":
      return { error: t("找不到这个好友码，格式应为 用户名#1234") };
  }
}

async function guardRequests(userId: string): Promise<FormState | null> {
  const t = await getT();
  return (await rateLimit(`friend-request:${userId}`, 30, 3600))
    ? null
    : { error: t("操作过于频繁，请稍后再试") };
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
  const t = await getT();
  const user = await requireUser();
  const expiry = String(form.get("expiry")) as InviteExpiry;
  const maxUses = String(form.get("maxUses"));
  if (!(expiry in INVITE_EXPIRY_OPTIONS) || !INVITE_MAX_USES_OPTIONS.includes(maxUses as never)) {
    return { error: t("参数无效") };
  }
  if (!(await rateLimit(`invite-create:${user.id}`, 20, 3600))) {
    return { error: t("创建过于频繁，请稍后再试") };
  }
  await createInvite(user.id, {
    expiresInMs: INVITE_EXPIRY_OPTIONS[expiry],
    maxUses: parseMaxUses(maxUses),
  });
  revalidatePath("/friends");
  return { ok: t("邀请链接已创建") };
}

export async function revokeInviteLink(inviteId: string): Promise<void> {
  const user = await requireUser();
  await revokeInvite(user.id, inviteId);
  revalidatePath("/friends");
}

export async function acceptInvite(code: string): Promise<FormState> {
  const t = await getT();
  const user = await requireUser();
  const result = await redeemInvite(user.id, code);
  switch (result.kind) {
    case "befriended":
    case "already-friends":
      revalidatePath("/friends");
      redirect(`/friends?added=${encodeURIComponent(result.creator.displayName)}`);
    case "own-invite":
      return { error: t("这是你自己的邀请链接") };
    case "invalid":
      return { error: t("邀请链接已失效") };
  }
}
