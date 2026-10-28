import Link from "next/link";
import { LoginForm } from "./auth-forms";
import { Alert, buttonClass, DiscordIcon, SteamIcon } from "./ui";
import { withBase } from "@/lib/urls";

/** Steam / Discord / password sign-in. Used by /login and the signed-out home page. */
export function LoginPanel({
  title,
  level = 1,
  error,
  reset,
  next,
}: {
  title: string;
  /** The home page already has an h1 (the pitch). */
  level?: 1 | 2;
  error?: string;
  reset?: boolean;
  next?: string;
}) {
  const Heading = level === 1 ? "h1" : "h2";
  const nextQuery = next ? `&next=${encodeURIComponent(next)}` : "";
  return (
    <div className="space-y-6">
      <Heading className="text-2xl font-bold">{title}</Heading>
      {error && <Alert kind="error">{error}</Alert>}
      {reset && <Alert kind="ok">密码已重置，请用新密码登录。</Alert>}

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
    </div>
  );
}
