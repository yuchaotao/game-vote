"use server";

import { AuthTokenType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { safeNext } from "@/lib/friends/rules";
import { redeemInvite } from "@/lib/friends/service";
import { hashPassword, verifyPassword } from "./crypto";
import { rateLimit } from "./rate-limit";
import { createSession, destroySession, requireUser } from "./session";
import {
  canUnlink,
  consumeToken,
  createLocalUser,
  isUniqueViolation,
  sendPasswordResetEmail,
  sendVerificationEmail,
  type Provider,
} from "./users";
import {
  displayNameSchema,
  emailSchema,
  firstError,
  loginSchema,
  normalizeUsername,
  passwordSchema,
  registerSchema,
  usernameSchema,
} from "./validation";

export type FormState = { error?: string; ok?: string } | undefined;

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function register(_: FormState, form: FormData): Promise<FormState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const { username, displayName, email, password } = parsed.data;

  if (!(await rateLimit(`register:${await clientIp()}`, 10, 3600))) {
    return { error: "注册过于频繁，请稍后再试" };
  }

  let user;
  try {
    user = await createLocalUser({
      username,
      displayName,
      email,
      passwordHash: await hashPassword(password),
    });
  } catch (err) {
    if (isUniqueViolation(err, "username")) return { error: "用户名已被占用" };
    if (isUniqueViolation(err, "email")) return { error: "该邮箱已注册" };
    throw err;
  }

  await sendVerificationEmail({ id: user.id, email, displayName: user.displayName });
  await createSession(user.id);

  // Signing up through someone's invite link makes you friends right away.
  const invite = String(form.get("invite") ?? "");
  if (invite) {
    const result = await redeemInvite(user.id, invite);
    if (result.kind === "befriended") {
      redirect(`/friends?added=${encodeURIComponent(result.creator.displayName)}`);
    }
  }
  redirect(safeNext(form.get("next")) ?? "/");
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstError(parsed.error) };
  const identifier = normalizeUsername(parsed.data.identifier);

  if (!(await rateLimit(`login:${await clientIp()}:${identifier}`, 10, 15 * 60))) {
    return { error: "尝试次数过多，请 15 分钟后再试" };
  }

  const user = await db.user.findFirst({
    where: identifier.includes("@") ? { email: identifier } : { username: identifier },
  });
  const valid =
    user?.passwordHash && (await verifyPassword(user.passwordHash, parsed.data.password));
  if (!user || !valid) return { error: "用户名/邮箱或密码错误" };

  await createSession(user.id);
  redirect(safeNext(form.get("next")) ?? "/");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const parsed = emailSchema.safeParse(form.get("email"));
  if (!parsed.success) return { error: firstError(parsed.error) };

  if (await rateLimit(`reset:${await clientIp()}`, 5, 3600)) {
    const user = await db.user.findUnique({ where: { email: parsed.data } });
    if (user?.email) await sendPasswordResetEmail({ ...user, email: user.email });
  }
  // Same response whether or not the email exists.
  return { ok: "如果该邮箱已注册，你会收到一封重置密码的邮件。" };
}

export async function resetPassword(_: FormState, form: FormData): Promise<FormState> {
  const password = passwordSchema.safeParse(form.get("password"));
  if (!password.success) return { error: firstError(password.error) };

  const userId = await consumeToken(String(form.get("token") ?? ""), AuthTokenType.PASSWORD_RESET);
  if (!userId) return { error: "链接无效或已过期，请重新申请" };

  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password.data) },
    }),
    // Sign out everywhere after a reset.
    db.session.deleteMany({ where: { userId } }),
  ]);
  redirect("/login?reset=1");
}

export async function updateProfile(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = z
    .object({ username: usernameSchema, displayName: displayNameSchema })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: firstError(parsed.error) };

  try {
    await db.user.update({ where: { id: user.id }, data: parsed.data });
  } catch (err) {
    if (isUniqueViolation(err, "username")) return { error: "用户名已被占用" };
    throw err;
  }
  revalidatePath("/", "layout");
  return { ok: "已保存" };
}

export async function updateEmail(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = emailSchema.safeParse(form.get("email"));
  if (!parsed.success) return { error: firstError(parsed.error) };
  if (parsed.data === user.email) return { ok: "邮箱未变化" };

  try {
    await db.user.update({
      where: { id: user.id },
      data: { email: parsed.data, emailVerifiedAt: null },
    });
  } catch (err) {
    if (isUniqueViolation(err, "email")) return { error: "该邮箱已被其他账号使用" };
    throw err;
  }
  await sendVerificationEmail({ id: user.id, email: parsed.data, displayName: user.displayName });
  revalidatePath("/settings");
  return { ok: "已保存，验证邮件已发送" };
}

export async function resendVerification(): Promise<FormState> {
  const user = await requireUser();
  if (!user.email || user.emailVerifiedAt) return { ok: "无需验证" };
  if (!(await rateLimit(`verify:${user.id}`, 3, 3600)))
    return { error: "发送过于频繁，请稍后再试" };
  await sendVerificationEmail({ ...user, email: user.email });
  return { ok: "验证邮件已发送" };
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const next = passwordSchema.safeParse(form.get("newPassword"));
  if (!next.success) return { error: firstError(next.error) };

  if (user.passwordHash) {
    const current = String(form.get("currentPassword") ?? "");
    if (!(await verifyPassword(user.passwordHash, current))) return { error: "当前密码不正确" };
  }
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(next.data) },
  });
  revalidatePath("/settings");
  return { ok: user.passwordHash ? "密码已修改" : "密码已设置，现在可以用用户名和密码登录" };
}

export async function unlinkAccount(provider: Provider): Promise<FormState> {
  const user = await requireUser();
  if (!canUnlink(user, provider)) {
    return { error: "解绑后将无法登录。请先设置密码或绑定其他登录方式。" };
  }
  await db.account.deleteMany({ where: { userId: user.id, provider } });
  revalidatePath("/settings");
  return { ok: "已解绑" };
}
