import Link from "next/link";
import { AcceptInviteButton } from "@/components/friends";
import { Alert, Avatar, buttonClass, Card } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { areFriends, findInvite } from "@/lib/friends/service";

export const metadata = { title: "好友邀请 · Game Vote" };

const INVALID: Record<string, string> = {
  expired: "这个邀请链接已过期。",
  "used-up": "这个邀请链接的使用次数已用完。",
  revoked: "这个邀请链接已被作废。",
};

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [invite, user] = await Promise.all([findInvite(code), getCurrentUser()]);
  const here = `/invite/${code}`;

  let body: React.ReactNode;
  if (!invite) {
    body = <Alert kind="error">邀请链接不存在。</Alert>;
  } else if (user?.id === invite.creatorId) {
    body = <Alert kind="info">这是你自己的邀请链接，把它发给朋友吧。</Alert>;
  } else if (user && (await areFriends(user.id, invite.creatorId))) {
    body = <Alert kind="ok">你们已经是好友了。</Alert>;
  } else if (invite.status !== "active") {
    body = <Alert kind="error">{INVALID[invite.status]}</Alert>;
  } else if (user) {
    body = <AcceptInviteButton code={code} />;
  } else {
    body = (
      <div className="space-y-2">
        <Link
          href={`/register?next=${encodeURIComponent(here)}`}
          className={buttonClass("primary", "w-full")}
        >
          注册并成为好友
        </Link>
        <Link
          href={`/login?next=${encodeURIComponent(here)}`}
          className={buttonClass("secondary", "w-full")}
        >
          已有账号？登录
        </Link>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-12">
      <Card className="space-y-6">
        {invite && (
          <div className="flex flex-col items-center gap-3 text-center">
            <Avatar src={invite.creator.avatarUrl} name={invite.creator.displayName} size={72} />
            <p className="text-lg">
              <span className="font-semibold">{invite.creator.displayName}</span> 邀请你成为好友
            </p>
          </div>
        )}
        {body}
        <p className="text-center text-sm">
          <Link href="/" className="text-indigo-600 hover:underline">
            返回首页
          </Link>
        </p>
      </Card>
    </main>
  );
}
