import Link from "next/link";
import { AcceptInviteButton } from "@/components/friends";
import { Alert, Avatar, buttonClass, Card } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth/session";
import { areFriends, findInvite } from "@/lib/friends/service";
import { getT } from "@/lib/i18n/server";
import { Trans } from "@/components/i18n";
import { msg } from "@/lib/i18n";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("好友邀请")} · Game Vote` };
}

const INVALID: Record<string, string> = {
  expired: msg("这个邀请链接已过期。"),
  "used-up": msg("这个邀请链接的使用次数已用完。"),
  revoked: msg("这个邀请链接已被作废。"),
};

export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const t = await getT();
  const { code } = await params;
  const [invite, user] = await Promise.all([findInvite(code), getCurrentUser()]);
  const here = `/invite/${code}`;

  let body: React.ReactNode;
  if (!invite) {
    body = <Alert kind="error">{t("邀请链接不存在。")}</Alert>;
  } else if (user?.id === invite.creatorId) {
    body = <Alert kind="info">{t("这是你自己的邀请链接，把它发给朋友吧。")}</Alert>;
  } else if (user && (await areFriends(user.id, invite.creatorId))) {
    body = <Alert kind="ok">{t("你们已经是好友了。")}</Alert>;
  } else if (invite.status !== "active") {
    body = <Alert kind="error">{t(INVALID[invite.status])}</Alert>;
  } else if (user) {
    body = <AcceptInviteButton code={code} />;
  } else {
    body = (
      <div className="space-y-2">
        <Link
          href={`/register?next=${encodeURIComponent(here)}`}
          className={buttonClass("primary", "w-full")}
        >
          {t("注册并成为好友")}
        </Link>
        <Link
          href={`/login?next=${encodeURIComponent(here)}`}
          className={buttonClass("secondary", "w-full")}
        >
          {t("已有账号？登录")}
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
              <Trans
                text="{name} 邀请你成为好友"
                values={{
                  name: <span className="font-semibold">{invite.creator.displayName}</span>,
                }}
              />
            </p>
          </div>
        )}
        {body}
        <p className="text-center text-sm">
          <Link href="/" className="text-indigo-600 hover:underline">
            {t("返回首页")}
          </Link>
        </p>
      </Card>
    </main>
  );
}
