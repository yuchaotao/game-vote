"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";
import { HomePageError, setHomePath } from "./service";
import { getT } from "@/lib/i18n/server";

export async function saveHomePage(_: FormState, form: FormData): Promise<FormState> {
  const t = await getT();
  const user = await requireUser();
  const path = String(form.get("homePath") ?? "") || null;
  try {
    await setHomePath(user.id, path);
  } catch (err) {
    if (err instanceof HomePageError) return { error: err.localize(t) };
    throw err;
  }
  revalidatePath("/settings");
  return { ok: path ? t("已设置默认首页") : t("首页将显示最近访问的页面") };
}
