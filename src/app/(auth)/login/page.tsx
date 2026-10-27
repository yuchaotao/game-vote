import { withBase } from "@/lib/urls";
import Link from "next/link";
import { LoginForm } from "@/components/auth-forms";
import { Alert, buttonClass, Card, DiscordIcon, SteamIcon } from "@/components/ui";
import { AUTH_ERRORS, pick } from "@/lib/auth/messages";
import { safeNext } from "@/lib/friends/rules";

export const metadata = { title: "登录 · Game Vote" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = pick(AUTH_ERRORS, params.error);
  const next = safeNext(params.next) ?? undefined;
  const nextQuery = next ? `&next=${encodeURIComponent(next)}` : "";

  return (
    <Card className="space-y-6">
      <h1 className="text-2xl font-bold">登录</h1>
      {error && <Alert kind="error">{error}</Alert>}
      {params.reset && <Alert kind="ok">密码已重置，请用新密码登录。</Alert>}

      <div className="space-y-2">
        <a
          href={withBase(`/api/auth/steam?intent=login${nextQuery}`)}
          className={buttonClass("steam", "w-full")}
        >
          <SteamIcon /> 通过 Steam 登录
        </a>
        <a
          href={withBase(`/api/auth/discord?intent=login${nextQuery}`)}
          className={buttonClass("discord", "w-full")}
        >
          <DiscordIcon /> 通过 Discord 登录
        </a>
        <p className="text-center text-xs text-zinc-500">Discord 登录仅限已在设置中绑定的账号</p>
      </div>

      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />或
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <LoginForm next={next} />

      <p className="text-center text-sm text-zinc-500">
        还没有账号？{" "}
        <Link
          href={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}
          className="text-indigo-600 hover:underline"
        >
          注册
        </Link>
      </p>
    </Card>
  );
}
