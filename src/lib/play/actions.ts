"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/auth/actions";
import { rateLimit } from "@/lib/auth/rate-limit";
import { requireUser } from "@/lib/auth/session";
import { isActiveMember } from "@/lib/groups/service";
import { checkIn, checkOut, PlayError } from "./service";
import { getT } from "@/lib/i18n/server";

export async function checkInAction(groupId: string, gameId: string): Promise<FormState> {
  const t = await getT();
  const user = await requireUser();
  if (!(await isActiveMember(groupId, user.id))) return { error: t("你不是这个群的成员") };
  if (!gameId) return { error: t("请选择游戏") };
  if (!(await rateLimit(`checkin:${user.id}`, 10, 600))) {
    return { error: t("签到太频繁了，请稍后再试") };
  }
  try {
    const game = await checkIn(groupId, user.id, gameId);
    revalidatePath(`/groups/${groupId}`, "layout");
    return { ok: t("已签到：正在玩《{name}》", { name: game.name }) };
  } catch (err) {
    if (err instanceof PlayError) return { error: err.localize(t) };
    throw err;
  }
}

export async function checkOutAction(groupId: string): Promise<FormState> {
  const t = await getT();
  const user = await requireUser();
  await checkOut(user.id);
  revalidatePath(`/groups/${groupId}`, "layout");
  return { ok: t("已结束签到") };
}
