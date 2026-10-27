import { absoluteUrl, withBase } from "@/lib/urls";
import QRCode from "qrcode";
import {
  AddFriendForm,
  CancelRequestButton,
  CopyButton,
  CreateInviteForm,
  InviteLinkRow,
  RemoveFriendButton,
  RequestActions,
  SuggestionAddButton,
} from "@/components/friends";
import { Alert, Avatar, buttonClass, Card, SteamIcon } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { formatFriendCode } from "@/lib/auth/validation";
import type { InviteStatus } from "@/lib/friends/rules";
import {
  listFriends,
  listInvites,
  listRequests,
  steamSuggestions,
  type PublicUser,
} from "@/lib/friends/service";

export const metadata = { title: "好友 · Game Vote" };

function UserLine({ user, children }: { user: PublicUser; children?: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar src={user.avatarUrl} name={user.displayName} size={36} />
        <div className="min-w-0">
          <p className="truncate font-medium">{user.displayName}</p>
          <p className="truncate font-mono text-xs text-zinc-500">{formatFriendCode(user)}</p>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  );
}

const STATUS_TEXT: Record<InviteStatus, string> = {
  active: "有效",
  expired: "已过期",
  "used-up": "次数已用完",
  revoked: "已作废",
};

const fmt = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Shanghai",
});

const STEAM_REASON: Record<string, string> = {
  "no-key": "站点尚未配置 Steam API Key，暂时无法读取 Steam 好友。",
  private: "读取失败：你的 Steam 好友列表不是公开的。可在 Steam 隐私设置中把“好友列表”设为公开。",
  error: "暂时无法连接 Steam，请稍后再试。",
};

export default async function FriendsPage({
  searchParams,
}: {
  searchParams: Promise<{ added?: string }>;
}) {
  const user = await requireUser();
  const { added } = await searchParams;
  const [friends, requests, invites, steam] = await Promise.all([
    listFriends(user.id),
    listRequests(user.id),
    listInvites(user.id),
    steamSuggestions(user.id),
  ]);

  const inviteRows = await Promise.all(
    invites.map(async (i) => {
      const url = absoluteUrl(`/invite/${i.code}`);
      const parts = [
        STATUS_TEXT[i.status],
        i.maxUses === null ? `已用 ${i.uses} 次` : `已用 ${i.uses}/${i.maxUses} 次`,
        i.expiresAt ? `${fmt.format(i.expiresAt)} 过期` : "永久有效",
      ];
      return {
        id: i.id,
        url,
        active: i.status === "active",
        summary: parts.join(" · "),
        qrSvg: await QRCode.toString(url, { type: "svg", margin: 1 }),
      };
    }),
  );

  const code = formatFriendCode(user);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">好友</h1>
      {added && <Alert kind="ok">你和 {added} 已成为好友！</Alert>}

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">添加好友</h2>
          <div className="flex items-center gap-2 text-sm">
            我的好友码
            <code className="rounded bg-zinc-100 px-2 py-1 font-mono dark:bg-zinc-800">{code}</code>
            <CopyButton text={code} />
          </div>
        </div>
        <AddFriendForm />
      </Card>

      {requests.incoming.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold">
            收到的申请 <span className="text-sm text-zinc-500">({requests.incoming.length})</span>
          </h2>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {requests.incoming.map((r) => (
              <UserLine key={r.id} user={r.from}>
                <RequestActions requestId={r.id} />
              </UserLine>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">
          我的好友 <span className="text-sm text-zinc-500">({friends.length})</span>
        </h2>
        {friends.length === 0 ? (
          <p className="py-4 text-sm text-zinc-500">还没有好友。把好友码或邀请链接发给朋友吧。</p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {friends.map((f) => (
              <UserLine key={f.id} user={f}>
                <RemoveFriendButton friendId={f.id} name={f.displayName} />
              </UserLine>
            ))}
          </ul>
        )}
      </Card>

      {requests.outgoing.length > 0 && (
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold">等待对方确认</h2>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {requests.outgoing.map((r) => (
              <UserLine key={r.id} user={r.to}>
                <CancelRequestButton requestId={r.id} />
              </UserLine>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">邀请链接</h2>
          <p className="text-sm text-zinc-500">
            朋友打开链接即可加你为好友；还没有账号的朋友注册后会自动成为你的好友。
          </p>
        </div>
        <CreateInviteForm />
        {inviteRows.length > 0 && (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {inviteRows.map((row) => (
              <InviteLinkRow
                key={row.id}
                inviteId={row.id}
                url={row.url}
                qrSvg={row.qrSvg}
                summary={row.summary}
                active={row.active}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <SteamIcon /> Steam 好友推荐
        </h2>
        {steam.ok ? (
          steam.users.length === 0 ? (
            <p className="py-2 text-sm text-zinc-500">
              你的 Steam 好友中暂时没有其他人注册本站（或都已经是好友了）。
            </p>
          ) : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {steam.users.map((u) => (
                <UserLine key={u.id} user={u}>
                  <SuggestionAddButton userId={u.id} />
                </UserLine>
              ))}
            </ul>
          )
        ) : steam.reason === "not-linked" ? (
          <div className="flex items-center justify-between gap-3 py-2">
            <p className="text-sm text-zinc-500">
              绑定 Steam 后，可以找到已注册本站的 Steam 好友。
            </p>
            <a href={withBase("/api/auth/steam?intent=link")} className={buttonClass("steam")}>
              绑定 Steam
            </a>
          </div>
        ) : (
          <p className="py-2 text-sm text-zinc-500">{STEAM_REASON[steam.reason]}</p>
        )}
      </Card>
    </main>
  );
}
