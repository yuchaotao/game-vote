import { z } from "zod";
import { msg, type T } from "@/lib/i18n";

// Letters, digits, underscore and CJK characters. Stored lowercase.
const USERNAME_RE = /^[a-z0-9_一-鿿]{3,20}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .refine((v) => USERNAME_RE.test(v), msg("用户名需为 3–20 位字母、数字、下划线或中文"));

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, msg("昵称不能为空"))
  .max(32, msg("昵称最多 32 个字符"));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email(msg("邮箱格式不正确")));

export const passwordSchema = z
  .string()
  .min(8, msg("密码至少 8 位"))
  .max(128, msg("密码最多 128 位"));

export const registerSchema = z.object({
  username: usernameSchema,
  displayName: z
    .string()
    .trim()
    .max(32, msg("昵称最多 32 个字符"))
    .optional()
    .transform((v) => v || undefined),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, msg("请输入用户名或邮箱")),
  password: z.string().min(1, msg("请输入密码")),
});

/** Parses `name#1234` into its parts, or null if malformed. */
export function parseFriendCode(code: string): { username: string; friendTag: string } | null {
  const m = /^(.+)#(\d{4})$/.exec(code.trim());
  if (!m) return null;
  const username = normalizeUsername(m[1]);
  if (!USERNAME_RE.test(username)) return null;
  return { username, friendTag: m[2] };
}

export function formatFriendCode(user: { username: string; friendTag: string }): string {
  return `${user.username}#${user.friendTag}`;
}

/** Derives a valid username candidate from arbitrary text (e.g. a Steam persona name). */
export function usernameFromText(text: string): string {
  const cleaned = normalizeUsername(text)
    .replace(/[^a-z0-9_一-鿿]/g, "")
    .slice(0, 16);
  return cleaned.length >= 3 ? cleaned : `player${cleaned}`;
}

/** The first problem, in the reader's language; `.max()` messages can say {max}. */
export function firstError(error: z.ZodError, t: T): string {
  const issue = error.issues[0];
  if (!issue) return t("输入有误");
  return t(issue.message, "maximum" in issue ? { max: Number(issue.maximum) } : undefined);
}
