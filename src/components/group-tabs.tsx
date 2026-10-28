"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { GROUP_TABS as TABS } from "@/lib/home/rules";

export function GroupTabs({ groupId, unread }: { groupId: string; unread: number }) {
  const pathname = usePathname();
  const base = `/groups/${groupId}`;
  // The group layout (and the count it passed in) stays mounted while switching
  // tabs, so after reading the chat the old count would come back on the next tab.
  // Opening the chat reads everything: hide that count until a different one arrives.
  const onChat = pathname.startsWith(`${base}/chat`);
  const [readCount, setReadCount] = useState<number | null>(null);
  useEffect(() => {
    if (onChat) setReadCount(unread);
  }, [onChat, unread]);
  const shown = readCount === unread ? 0 : unread;
  return (
    <nav aria-label="群功能" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
      {TABS.map((t) => {
        const href = `${base}${t.path}`;
        // Sub-pages (a game's details) keep their section highlighted.
        const active = t.path === "" ? pathname === href : pathname.startsWith(href);
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
            {t.path === "/chat" && shown > 0 && !active && (
              <span
                aria-label={`${shown} 条未读消息`}
                className="rounded-full bg-red-500 px-1.5 text-xs leading-5 text-white"
              >
                {shown > 99 ? "99+" : shown}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
