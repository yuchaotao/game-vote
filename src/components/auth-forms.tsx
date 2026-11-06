"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  changePassword,
  login,
  register,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  unlinkAccount,
  updateEmail,
  updateProfile,
  type FormState,
} from "@/lib/auth/actions";
import type { Provider } from "@/lib/auth/users";
import { Alert, Button, Field } from "./ui";
import { useT } from "./i18n";

function Status({ state }: { state: FormState }) {
  if (state?.error) return <Alert kind="error">{state.error}</Alert>;
  if (state?.ok) return <Alert kind="ok">{state.ok}</Alert>;
  return null;
}

export function LoginForm({ next }: { next?: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="space-y-4">
      <Status state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field label={t("用户名或邮箱")} name="identifier" autoComplete="username" required />
      <Field
        label={t("密码")}
        name="password"
        type="password"
        autoComplete="current-password"
        required
        hint={
          <Link href="/forgot-password" className="text-indigo-600 hover:underline">
            {t("忘记密码？")}
          </Link>
        }
      />
      <Button className="w-full" disabled={pending}>
        {pending ? t("登录中…") : t("登录")}
      </Button>
    </form>
  );
}

export function RegisterForm({ next, invite }: { next?: string; invite?: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(register, undefined);
  return (
    <form action={action} className="space-y-4">
      <Status state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      {invite && <input type="hidden" name="invite" value={invite} />}
      <Field
        label={t("用户名")}
        name="username"
        autoComplete="username"
        required
        hint={t("3–20 位，用于登录和好友码")}
      />
      <Field label={t("昵称")} name="displayName" hint={t("可选，默认同用户名")} />
      <Field label={t("邮箱")} name="email" type="email" autoComplete="email" required />
      <Field
        label={t("密码")}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        hint={t("至少 8 位")}
      />
      <Button className="w-full" disabled={pending}>
        {pending ? t("注册中…") : t("注册")}
      </Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const t = useT();
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  return (
    <form action={action} className="space-y-4">
      <Status state={state} />
      <Field label={t("注册邮箱")} name="email" type="email" autoComplete="email" required />
      <Button className="w-full" disabled={pending}>
        {t("发送重置邮件")}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(resetPassword, undefined);
  return (
    <form action={action} className="space-y-4">
      <Status state={state} />
      <input type="hidden" name="token" value={token} />
      <Field
        label={t("新密码")}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <Button className="w-full" disabled={pending}>
        {t("重置密码")}
      </Button>
    </form>
  );
}

export function ProfileForm({ username, displayName }: { username: string; displayName: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(updateProfile, undefined);
  return (
    <form action={action} className="space-y-4">
      <Status state={state} />
      <Field label={t("昵称")} name="displayName" defaultValue={displayName} required />
      <Field
        label={t("用户名")}
        name="username"
        defaultValue={username}
        required
        hint={t("修改后好友码也会变化")}
      />
      <Button disabled={pending}>{t("保存")}</Button>
    </form>
  );
}

export function EmailForm({ email, verified }: { email: string | null; verified: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(updateEmail, undefined);
  const [resendState, resend, resending] = useActionState(resendVerification, undefined);
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4">
        <Status state={state} />
        <Field
          label={t("邮箱")}
          name="email"
          type="email"
          defaultValue={email ?? ""}
          required
          hint={email ? (verified ? t("✓ 已验证") : t("未验证")) : t("用于通知和找回密码")}
        />
        <Button disabled={pending}>{t("保存邮箱")}</Button>
      </form>
      {email && !verified && (
        <form action={resend} className="space-y-2">
          <Status state={resendState} />
          <Button variant="secondary" disabled={resending}>
            {t("重新发送验证邮件")}
          </Button>
        </form>
      )}
    </div>
  );
}

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const t = useT();
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="space-y-4">
      <Status state={state} />
      {hasPassword && (
        <Field
          label={t("当前密码")}
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      )}
      <Field
        label={hasPassword ? t("新密码") : t("设置密码")}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        minLength={8}
        required
        hint={t("至少 8 位")}
      />
      <Button disabled={pending}>{hasPassword ? t("修改密码") : t("设置密码")}</Button>
    </form>
  );
}

export function UnlinkButton({ provider }: { provider: Provider }) {
  const t = useT();
  const [state, action, pending] = useActionState(() => unlinkAccount(provider), undefined);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <Button variant="secondary" disabled={pending}>
        {t("解绑")}
      </Button>
      {state?.error && <Alert kind="error">{state.error}</Alert>}
    </form>
  );
}
