import Link from "next/link";
import { logout } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth/session";
import { countIncomingRequests } from "@/lib/friends/service";
import { countPendingApprovals } from "@/lib/groups/service";
import { Avatar, buttonClass } from "./ui";
import { getT } from "@/lib/i18n/server";

function NavLink({
  href,
  label,
  badge,
  badgeLabel,
}: {
  href: string;
  label: string;
  badge: number;
  badgeLabel: string;
}) {
  return (
    <Link href={href} className={buttonClass("ghost", "relative px-2 py-1.5 sm:px-3")}>
      {label}
      {badge > 0 && (
        <span
          aria-label={badgeLabel}
          className="absolute -top-1 -right-1 min-w-5 rounded-full bg-red-500 px-1.5 text-center text-xs leading-5 text-white"
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

export async function SiteHeader() {
  const t = await getT();
  const user = await getCurrentUser();
  const [pendingRequests, pendingApprovals] = user
    ? await Promise.all([countIncomingRequests(user.id), countPendingApprovals(user.id)])
    : [0, 0];

  return (
    <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link
          href="/"
          className="shrink-0 text-base font-bold tracking-tight whitespace-nowrap sm:text-lg"
        >
          🎮 Game Vote
        </Link>
        {user ? (
          <div className="flex items-center gap-1 sm:gap-2">
            <NavLink
              href="/groups"
              label={t("群组")}
              badge={pendingApprovals}
              badgeLabel={t("{n} 个入群申请待审批", { n: pendingApprovals })}
            />
            <NavLink
              href="/friends"
              label={t("好友")}
              badge={pendingRequests}
              badgeLabel={t("{n} 个好友申请", { n: pendingRequests })}
            />
            <Link
              href="/settings"
              className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Avatar src={user.avatarUrl} name={user.displayName} size={28} />
              <span className="hidden text-sm font-medium sm:inline">{user.displayName}</span>
            </Link>
            <form action={logout}>
              <button className={buttonClass("ghost", "px-2 py-1")}>{t("退出")}</button>
            </form>
          </div>
        ) : (
          <nav className="flex items-center gap-2">
            <Link href="/login" className={buttonClass("ghost", "px-3 py-1.5")}>
              {t("登录")}
            </Link>
            <Link href="/register" className={buttonClass("primary", "px-3 py-1.5")}>
              {t("注册")}
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
