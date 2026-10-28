import { withBase } from "@/lib/urls";
import { EmailForm, PasswordForm, ProfileForm, UnlinkButton } from "@/components/auth-forms";
import { Alert, Avatar, buttonClass, Card, DiscordIcon, SteamIcon } from "@/components/ui";
import { AUTH_ERRORS, LINKED_MESSAGES, pick } from "@/lib/auth/messages";
import { requireUser } from "@/lib/auth/session";
import type { Provider } from "@/lib/auth/users";
import { formatFriendCode } from "@/lib/auth/validation";
import { lastSteamSession, presenceFor } from "@/lib/play/service";
import { LocalDate } from "@/components/games";
import { HomePageForm } from "@/components/home";
import { NotificationSettings } from "@/components/notifications";
import { listMyGroups } from "@/lib/groups/service";
import { notificationSettings } from "@/lib/notify/service";

export const metadata = { title: "设置 · Game Vote" };

const PROVIDERS: { id: Provider; name: string; icon: React.ReactNode; purpose: string }[] = [
  {
    id: "steam",
    name: "Steam",
    icon: <SteamIcon />,
    purpose: "登录、导入 Steam 好友、检测正在玩的游戏",
  },
  {
    id: "discord",
    name: "Discord",
    icon: <DiscordIcon />,
    purpose: "Discord 私信通知、检测正在玩的游戏",
  },
];

const STEAM_PRIVACY_URL = "https://steamcommunity.com/my/edit/settings";

/** Whether Steam play detection can work for this user, and what it last saw. */
function SteamDetection({
  isPrivate,
  last,
}: {
  isPrivate: boolean;
  last: { name: string; at: Date } | null;
}) {
  const privacyLink = (
    <a href={STEAM_PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="underline">
      Steam 隐私设置
    </a>
  );
  if (isPrivate) {
    return (
      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
        ⚠ 你的 Steam 资料不是公开的，无法检测正在玩的游戏。请在{privacyLink}
        中把「我的个人资料」和「游戏详情」设为公开。
      </p>
    );
  }
  if (last) {
    return (
      <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
        ✓ 游玩检测正常。最近检测到：《{last.name}》（
        <LocalDate value={last.at} />）
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs text-zinc-500">
      还没检测到你在玩游戏。如果玩游戏时这里一直没有变化，请在{privacyLink}
      中把「游戏详情」设为公开。
    </p>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const error = pick(AUTH_ERRORS, params.error);
  const linked = pick(LINKED_MESSAGES, params.linked);
  const [presence, lastSteam, notifications, groups] = await Promise.all([
    presenceFor([user.id]).then((p) => p[user.id]),
    lastSteamSession(user.id),
    notificationSettings(user.id),
    listMyGroups(user.id),
  ]);

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-4">
        <Avatar src={user.avatarUrl} name={user.displayName} size={56} />
        <div>
          <h1 className="text-2xl font-bold">{user.displayName}</h1>
          <p className="text-sm text-zinc-500">
            好友码：
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-zinc-800 select-all dark:bg-zinc-800 dark:text-zinc-200">
              {formatFriendCode(user)}
            </code>
          </p>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {linked && <Alert kind="ok">{linked}</Alert>}

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">个人资料</h2>
        <ProfileForm username={user.username} displayName={user.displayName} />
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">关联账号</h2>
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {PROVIDERS.map((p) => {
            const account = user.accounts.find((a) => a.provider === p.id);
            return (
              <li key={p.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {p.icon} {p.name}
                    {account && (
                      <span className="truncate text-sm font-normal text-zinc-500">
                        · {account.displayName ?? account.providerAccountId}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">{p.purpose}</p>
                  {p.id === "steam" && account && (
                    <SteamDetection
                      isPrivate={presence.steamPrivate === true}
                      last={lastSteam && { name: lastSteam.game.name, at: lastSteam.lastSeenAt }}
                    />
                  )}
                </div>
                {account ? (
                  <UnlinkButton provider={p.id} />
                ) : (
                  <a href={withBase(`/api/auth/${p.id}?intent=link`)} className={buttonClass(p.id)}>
                    绑定
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">邮箱</h2>
        <EmailForm email={user.email} verified={Boolean(user.emailVerifiedAt)} />
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">首页</h2>
        <HomePageForm
          current={user.homePath}
          groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        />
      </Card>

      <Card id="notifications" className="scroll-mt-20 space-y-4">
        <h2 className="text-lg font-semibold">通知</h2>
        <NotificationSettings {...notifications} />
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">密码</h2>
        {!user.passwordHash && (
          <p className="text-sm text-zinc-500">
            你目前只能通过关联账号登录。设置密码后也可以用用户名 <code>{user.username}</code>{" "}
            和密码登录。
          </p>
        )}
        <PasswordForm hasPassword={Boolean(user.passwordHash)} />
      </Card>
    </main>
  );
}
