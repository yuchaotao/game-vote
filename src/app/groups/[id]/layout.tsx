import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getGroupForMember } from "@/lib/groups/service";

// Sections fill in as features land: chat (#5), games (#6), voting (#9).
const TABS = [
  { label: "成员", path: "" },
  { label: "聊天", path: null },
  { label: "游戏库", path: null },
  { label: "投票", path: null },
] as const;

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const group = await getGroupForMember(id, user.id);
  if (!group) notFound();

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div>
        <Link href="/groups" className="text-sm text-zinc-500 hover:underline">
          ← 我的群
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{group.name}</h1>
        {group.description && (
          <p className="mt-1 whitespace-pre-line text-zinc-600 dark:text-zinc-400">
            {group.description}
          </p>
        )}
      </div>
      <nav aria-label="群功能" className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) =>
          t.path !== null ? (
            <Link
              key={t.label}
              href={`/groups/${id}${t.path}`}
              aria-current="page"
              className="-mb-px border-b-2 border-indigo-600 px-3 py-2 text-sm font-medium"
            >
              {t.label}
            </Link>
          ) : (
            <span
              key={t.label}
              title="即将上线"
              className="cursor-not-allowed px-3 py-2 text-sm text-zinc-400"
            >
              {t.label}
            </span>
          ),
        )}
      </nav>
      {children}
    </main>
  );
}
