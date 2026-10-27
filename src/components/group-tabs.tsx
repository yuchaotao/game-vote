"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Sections fill in as features land: games (#6), voting (#9).
const TABS = [
  { label: "成员", path: "" },
  { label: "聊天", path: "/chat" },
  { label: "游戏库", path: null },
  { label: "投票", path: null },
] as const;

export function GroupTabs({ groupId, unread }: { groupId: string; unread: number }) {
  const pathname = usePathname();
  const base = `/groups/${groupId}`;
  return (
    <nav aria-label="群功能" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
      {TABS.map((t) => {
        if (t.path === null) {
          return (
            <span
              key={t.label}
              title="即将上线"
              className="cursor-not-allowed px-3 py-2 text-sm text-zinc-400"
            >
              {t.label}
            </span>
          );
        }
        const href = `${base}${t.path}`;
        const active = pathname === href;
        return (
          <Link
            key={t.label}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
              active
                ? "border-indigo-600"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
            }`}
          >
            {t.label}
            {t.path === "/chat" && unread > 0 && !active && (
              <span
                aria-label={`${unread} 条未读消息`}
                className="rounded-full bg-red-500 px-1.5 text-xs leading-5 text-white"
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
