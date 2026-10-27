import Link from "next/link";
import { notFound } from "next/navigation";
import { GroupTabs } from "@/components/group-tabs";
import { requireUser } from "@/lib/auth/session";
import { unreadCounts } from "@/lib/chat/service";
import { getGroupForMember } from "@/lib/groups/service";

export default async function GroupLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const [group, unread] = await Promise.all([
    getGroupForMember(id, user.id),
    unreadCounts(user.id),
  ]);
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
      <GroupTabs groupId={id} unread={unread[id] ?? 0} />
      {children}
    </main>
  );
}
