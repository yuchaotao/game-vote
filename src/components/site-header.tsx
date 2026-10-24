import Link from "next/link";
import { logout } from "@/lib/auth/actions";
import { getCurrentUser } from "@/lib/auth/session";
import { Avatar, buttonClass } from "./ui";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          🎮 Game Vote
        </Link>
        {user ? (
          <div className="flex items-center gap-2">
            <Link
              href="/settings"
              className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <Avatar src={user.avatarUrl} name={user.displayName} size={28} />
              <span className="hidden text-sm font-medium sm:inline">{user.displayName}</span>
            </Link>
            <form action={logout}>
              <button className={buttonClass("ghost", "px-2 py-1")}>退出</button>
            </form>
          </div>
        ) : (
          <nav className="flex items-center gap-2">
            <Link href="/login" className={buttonClass("ghost", "px-3 py-1.5")}>
              登录
            </Link>
            <Link href="/register" className={buttonClass("primary", "px-3 py-1.5")}>
              注册
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
