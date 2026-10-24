import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth-forms";
import { Card } from "@/components/ui";

export const metadata = { title: "忘记密码 · Game Vote" };

export default function ForgotPasswordPage() {
  return (
    <Card className="space-y-6">
      <h1 className="text-2xl font-bold">忘记密码</h1>
      <p className="text-sm text-zinc-500">输入注册邮箱，我们会发送一封重置密码的邮件。</p>
      <ForgotPasswordForm />
      <p className="text-center text-sm">
        <Link href="/login" className="text-indigo-600 hover:underline">
          返回登录
        </Link>
      </p>
    </Card>
  );
}
