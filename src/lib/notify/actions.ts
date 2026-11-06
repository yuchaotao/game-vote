"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";
import { savePreferences } from "./service";
import { getT } from "@/lib/i18n/server";

export async function saveNotificationPreferences(
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const t = await getT();
  const user = await requireUser();
  // Checked boxes are submitted as `EVENT:CHANNEL=on`; unchecked ones are absent.
  await savePreferences(user.id, new Set(form.keys()));
  revalidatePath("/settings");
  return { ok: t("通知设置已保存") };
}
