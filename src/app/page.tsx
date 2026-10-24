import Link from "next/link";
import { Alert, buttonClass } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { formatFriendCode } from "@/lib/auth/validation";

export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16">
        <h1 className="text-4xl font-bold tracking-tight">下一次玩什么？投票决定。</h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          和朋友一起建群、聊天、维护游戏库，投票决定下一次玩什么。
        </p>
        <ul className="grid gap-2 text-zinc-700 sm:grid-cols-2 dark:text-zinc-300">
          <li>🎮 Steam / 本站账号登录</li>
          <li>👥 好友与群组</li>
          <li>📚 群游戏库与热度排行</li>
          <li>🗳️ 投票与历史回放</li>
        </ul>
        <div className="flex gap-3">
          <Link href="/register" className={buttonClass("primary")}>
            立即注册
          </Link>
          <Link href="/login" className={buttonClass("secondary")}>
            登录
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-bold">欢迎，{user.displayName}</h1>
      {user.email && !user.emailVerifiedAt && (
        <Alert kind="info">
          你的邮箱还未验证，部分通知可能无法送达。
          <Link href="/settings" className="ml-1 underline">
            去设置
          </Link>
        </Alert>
      )}
      <p className="text-zinc-600 dark:text-zinc-400">
        你的好友码是 <code className="font-mono">{formatFriendCode(user)}</code>。
        <Link href="/friends" className="ml-1 text-indigo-600 hover:underline">
          去添加好友 →
        </Link>
      </p>
      <p className="text-sm text-zinc-500">群组与投票功能即将上线。</p>
    </main>
  );
}
