import Link from "next/link";
import { RegisterForm } from "@/components/auth-forms";
import { buttonClass, Card, SteamIcon } from "@/components/ui";

export const metadata = { title: "注册 · Game Vote" };

export default function RegisterPage() {
  return (
    <Card className="space-y-6">
      <h1 className="text-2xl font-bold">注册</h1>

      <a href="/api/auth/steam?intent=login" className={buttonClass("steam", "w-full")}>
        <SteamIcon /> 用 Steam 账号直接注册
      </a>

      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        或创建本站账号
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <RegisterForm />

      <p className="text-center text-sm text-zinc-500">
        已有账号？{" "}
        <Link href="/login" className="text-indigo-600 hover:underline">
          登录
        </Link>
      </p>
    </Card>
  );
}
