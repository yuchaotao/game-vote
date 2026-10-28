import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Landing } from "@/components/landing";
import { LoginPanel } from "@/components/login-panel";
import { Alert, buttonClass, Card } from "@/components/ui";
import { AUTH_ERRORS, pick } from "@/lib/auth/messages";
import { getCurrentUser } from "@/lib/auth/session";
import { formatFriendCode } from "@/lib/auth/validation";
import { LAST_PAGE_COOKIE } from "@/lib/home/rules";
import { homeTarget } from "@/lib/home/service";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    const params = await searchParams;
    return (
      <Landing>
        <LoginPanel title="登录" level={2} error={pick(AUTH_ERRORS, params.error)} />
      </Landing>
    );
  }

  // Back to where they were (or their chosen home page).
  const last = (await cookies()).get(LAST_PAGE_COOKIE)?.value;
  const target = await homeTarget(user.id, user.homePath, last && decodeURIComponent(last));
  if (target) redirect(target);

  // No group yet: how to get started.
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <h1 className="text-2xl font-bold">欢迎，{user.displayName}</h1>
      {user.email && !user.emailVerifiedAt && (
        <Alert kind="info">
          你的邮箱还未验证，部分通知可能无法送达。
          <Link href="/settings" className="ml-1 underline">
            去设置
          </Link>
        </Alert>
      )}
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">开始使用</h2>
        <ol className="space-y-4 text-sm">
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              1
            </span>
            <div className="space-y-1">
              <p>
                加好友。把你的好友码发给朋友：
                <code className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 font-mono select-all dark:bg-zinc-800">
                  {formatFriendCode(user)}
                </code>
              </p>
              <Link href="/friends" className="text-indigo-600 hover:underline">
                去添加好友 →
              </Link>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              2
            </span>
            <div className="space-y-2">
              <p>
                建一个群，拉好友进来，或者等朋友把你拉进他们的群。之后打开网站会回到你上次看的页面，也可以在设置里指定默认首页。
              </p>
              <Link href="/groups" className={buttonClass("primary")}>
                去建群
              </Link>
            </div>
          </li>
        </ol>
      </Card>
    </main>
  );
}
