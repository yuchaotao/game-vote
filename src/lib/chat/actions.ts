"use server";

import { rateLimit } from "@/lib/auth/rate-limit";
import { requireUser } from "@/lib/auth/session";
import { isActiveMember } from "@/lib/groups/service";
import { MAX_MESSAGE_LENGTH, normalizeBody, type ChatMessageDTO } from "./format";
import { listMessages, markRead, postMessage } from "./service";

export type SendResult = { message: ChatMessageDTO } | { error: string };

export async function sendMessageAction(groupId: string, raw: string): Promise<SendResult> {
  const user = await requireUser();
  if (!(await isActiveMember(groupId, user.id))) return { error: "你不是这个群的成员" };
  const body = normalizeBody(raw);
  if (!body) return { error: `消息不能为空，最多 ${MAX_MESSAGE_LENGTH} 字` };
  if (!(await rateLimit(`chat:${user.id}`, 20, 10))) return { error: "发送太快了，请稍等" };
  return { message: await postMessage(groupId, user.id, body) };
}

export async function loadOlderAction(groupId: string, beforeId: string) {
  const user = await requireUser();
  if (!(await isActiveMember(groupId, user.id))) return { messages: [], hasMore: false };
  return listMessages(groupId, { beforeId });
}

export async function markReadAction(groupId: string): Promise<void> {
  const user = await requireUser();
  await markRead(groupId, user.id);
}
