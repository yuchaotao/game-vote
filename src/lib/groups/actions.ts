"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/auth/actions";
import { rateLimit } from "@/lib/auth/rate-limit";
import { requireUser } from "@/lib/auth/session";
import { firstError } from "@/lib/auth/validation";
import { db } from "@/lib/db";
import { groupInfoSchema, type InviteOutcome } from "./rules";
import {
  cancelJoinRequest,
  createGroup,
  decideJoinRequest,
  dissolveGroup,
  GroupError,
  inviteToGroup,
  leaveGroup,
  removeMember,
  setDiscordChannel,
  transferOwnership,
  updateGroupInfo,
} from "./service";
import { msg } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

/** Runs a group operation, turning domain errors into form errors. */
async function attempt(fn: () => Promise<FormState | void>): Promise<FormState> {
  const t = await getT();
  try {
    return (await fn()) ?? { ok: t("已完成") };
  } catch (err) {
    if (err instanceof GroupError) return { error: err.localize(t) };
    throw err;
  }
}

function refresh(groupId?: string) {
  revalidatePath("/groups");
  if (groupId) revalidatePath(`/groups/${groupId}`, "layout");
  revalidatePath("/", "layout");
}

export async function createGroupAction(_: FormState, form: FormData): Promise<FormState> {
  const t = await getT();
  const user = await requireUser();
  const parsed = groupInfoSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstError(parsed.error, t) };
  if (!(await rateLimit(`group-create:${user.id}`, 10, 3600))) {
    return { error: t("创建过于频繁，请稍后再试") };
  }
  const group = await createGroup(user.id, parsed.data);
  refresh();
  redirect(`/groups/${group.id}`);
}

const OUTCOME_TEXT: Record<InviteOutcome, string> = {
  added: msg("已加入群"),
  requested: msg("已提交，等待群主确认"),
  "already-member": msg("已经是群成员"),
  "already-pending": msg("已有待审批的申请"),
  "not-friend": msg("不是你的好友"),
};

export async function inviteToGroupAction(
  groupId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const t = await getT();
  const user = await requireUser();
  const ids = form.getAll("userId").map(String);
  if (ids.length === 0) return { error: t("请选择要邀请的好友") };
  return attempt(async () => {
    const results = await inviteToGroup(groupId, user.id, ids);
    refresh(groupId);
    const users = await db.user.findMany({
      where: { id: { in: Object.keys(results) } },
      select: { id: true, displayName: true },
    });
    const lines = users.map((u) =>
      t("{name}：{outcome}", { name: u.displayName, outcome: t(OUTCOME_TEXT[results[u.id]]) }),
    );
    return { ok: lines.join(t("；")) };
  });
}

export async function decideJoinRequestAction(
  groupId: string,
  requestId: string,
  approve: boolean,
): Promise<FormState> {
  const user = await requireUser();
  return attempt(async () => {
    await decideJoinRequest(groupId, user.id, requestId, approve);
    refresh(groupId);
  });
}

export async function cancelJoinRequestAction(
  groupId: string,
  requestId: string,
): Promise<FormState> {
  const user = await requireUser();
  return attempt(async () => {
    await cancelJoinRequest(groupId, user.id, requestId);
    refresh(groupId);
  });
}

export async function removeMemberAction(groupId: string, memberId: string): Promise<FormState> {
  const user = await requireUser();
  return attempt(async () => {
    await removeMember(groupId, user.id, memberId);
    refresh(groupId);
  });
}

export async function transferOwnershipAction(
  groupId: string,
  newOwnerId: string,
): Promise<FormState> {
  const user = await requireUser();
  return attempt(async () => {
    await transferOwnership(groupId, user.id, newOwnerId);
    refresh(groupId);
  });
}

export async function updateGroupInfoAction(
  groupId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const t = await getT();
  const user = await requireUser();
  const parsed = groupInfoSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstError(parsed.error, t) };
  return attempt(async () => {
    await updateGroupInfo(groupId, user.id, parsed.data);
    refresh(groupId);
    return { ok: t("已保存") };
  });
}

export async function leaveGroupAction(groupId: string): Promise<FormState> {
  const user = await requireUser();
  const result = await attempt(() => leaveGroup(groupId, user.id));
  if (result?.error) return result;
  refresh(groupId);
  redirect("/groups?left=1");
}

export async function dissolveGroupAction(groupId: string): Promise<FormState> {
  const user = await requireUser();
  const result = await attempt(() => dissolveGroup(groupId, user.id));
  if (result?.error) return result;
  refresh(groupId);
  redirect("/groups?dissolved=1");
}

export async function setDiscordChannelAction(
  groupId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const t = await getT();
  const user = await requireUser();
  const channelId = String(form.get("channelId") ?? "") || null;
  const result = await attempt(() => setDiscordChannel(groupId, user.id, channelId));
  if (result?.error) return result;
  refresh(groupId);
  return {
    ok: channelId
      ? t("已连接 Discord 频道，机器人在频道里发了一条确认消息")
      : t("已取消 Discord 频道通知"),
  };
}
