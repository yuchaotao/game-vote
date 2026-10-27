import { withBase } from "@/lib/urls";
import Link from "next/link";
import { RegisterForm } from "@/components/auth-forms";
import { Alert, buttonClass, Card, SteamIcon } from "@/components/ui";
import { inviteCodeFromPath, safeNext } from "@/lib/friends/rules";
import { findInvite } from "@/lib/friends/service";

export const metadata = { title: "注册 · Game Vote" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next) ?? undefined;
  const nextQuery = next ? `&next=${encodeURIComponent(next)}` : "";

  // Arriving from an invite link: show who invited you; signing up befriends them.
  const inviteCode = inviteCodeFromPath(next ?? null);
  const invite = inviteCode ? await findInvite(inviteCode) : null;
  const activeInvite = invite?.status === "active" ? invite : null;

  return (
    <Card className="space-y-6">
      <h1 className="text-2xl font-bold">注册</h1>
      {activeInvite && (
        <Alert kind="info">
          {activeInvite.creator.displayName} 邀请你加入 Game Vote。注册后你们会自动成为好友。
        </Alert>
      )}

      <a
        href={withBase(`/api/auth/steam?intent=login${nextQuery}`)}
        className={buttonClass("steam", "w-full")}
      >
        <SteamIcon /> 用 Steam 账号直接注册
      </a>

      <div className="flex items-center gap-3 text-xs text-zinc-400">
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        或创建本站账号
        <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <RegisterForm next={next} invite={activeInvite ? inviteCode! : undefined} />

      <p className="text-center text-sm text-zinc-500">
        已有账号？{" "}
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="text-indigo-600 hover:underline"
        >
          登录
        </Link>
      </p>
    </Card>
  );
}
