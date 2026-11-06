import Link from "next/link";
import { CreateGroupForm } from "@/components/groups";
import { Alert, Card } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { unreadCounts } from "@/lib/chat/service";
import { listMyGroups } from "@/lib/groups/service";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("群组")} · Game Vote` };
}

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ left?: string; dissolved?: string }>;
}) {
  const t = await getT();
  const user = await requireUser();
  const params = await searchParams;
  const [groups, unread] = await Promise.all([listMyGroups(user.id), unreadCounts(user.id)]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <h1 className="text-2xl font-bold">{t("群组")}</h1>
      {params.left && <Alert kind="ok">{t("已退出群。")}</Alert>}
      {params.dissolved && <Alert kind="ok">{t("群已解散。")}</Alert>}

      <section aria-labelledby="my-groups" className="space-y-3">
        <h2 id="my-groups" className="text-lg font-semibold">
          {t("我的群")} <span className="text-sm text-zinc-500">({groups.length})</span>
        </h2>
        {groups.length === 0 ? (
          <p className="text-sm text-zinc-500">
            {t("还没有加入任何群。创建一个，然后拉好友进来吧。")}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/groups/${g.id}`}
                  className="block rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-indigo-400 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-semibold">{g.name}</p>
                    <span className="flex shrink-0 gap-1">
                      {(unread[g.id] ?? 0) > 0 && (
                        <span className="rounded-full bg-indigo-600 px-2 text-xs leading-5 text-white">
                          {t("{n} 条未读", { n: unread[g.id] })}
                        </span>
                      )}
                      {g.pendingCount > 0 && (
                        <span className="rounded-full bg-red-500 px-2 text-xs leading-5 text-white">
                          {t("{n} 待审批", { n: g.pendingCount })}
                        </span>
                      )}
                    </span>
                  </div>
                  {g.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-500">{g.description}</p>
                  )}
                  <p className="mt-2 text-xs text-zinc-500">
                    {t("{n} 名成员 · 群主 {owner}", {
                      n: g.memberCount,
                      owner: g.isOwner ? t("（我）") : g.owner.displayName,
                    })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">{t("创建新群")}</h2>
        <CreateGroupForm />
      </Card>
    </main>
  );
}
