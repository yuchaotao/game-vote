import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth-forms";
import { Card } from "@/components/ui";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("忘记密码")} · Game Vote` };
}

export default async function ForgotPasswordPage() {
  const t = await getT();
  return (
    <Card className="space-y-6">
      <h1 className="text-2xl font-bold">{t("忘记密码")}</h1>
      <p className="text-sm text-zinc-500">{t("输入注册邮箱，我们会发送一封重置密码的邮件。")}</p>
      <ForgotPasswordForm />
      <p className="text-center text-sm">
        <Link href="/login" className="text-indigo-600 hover:underline">
          {t("返回登录")}
        </Link>
      </p>
    </Card>
  );
}
