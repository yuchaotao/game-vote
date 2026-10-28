import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDate } from "@/components/games";
import { Card } from "@/components/ui";
import { StartRoundForm } from "@/components/votes";
import { requireUser } from "@/lib/auth/session";
import { isActiveMember } from "@/lib/groups/service";
import { END_REASON_TEXT } from "@/lib/votes/rules";
import { listRounds } from "@/lib/votes/service";

export const metadata = { title: "投票 · Game Vote" };

export default async function GroupVotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (!(await isActiveMember(id, user.id))) notFound();
  const rounds = await listRounds(id);
  const open = rounds.find((r) => r.status === "OPEN");
  const past = rounds.filter((r) => r.status === "ENDED");

  return (
    <div className="space-y-6">
      {open ? (
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold">进行中的投票</h2>
          <Link
            href={`/groups/${id}/votes/${open.id}`}
            className="flex items-center justify-between gap-3 rounded-lg border border-indigo-300 bg-indigo-50 p-3 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950 dark:hover:bg-indigo-900"
          >
            <span className="font-medium">
              第 {open.number} 轮{open.title && `《${open.title}》`}
            </span>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              {open._count.candidates} 个候选 · {new Set(open.ballots.map((b) => b.userId)).size}{" "}
              人已投 →
            </span>
          </Link>
        </Card>
      ) : (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">发起投票</h2>
          <p className="text-sm text-zinc-500">决定下一次玩什么。发起后群里每个人都会看到。</p>
          <StartRoundForm groupId={id} />
        </Card>
      )}

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">
          历史投票 <span className="text-sm text-zinc-500">({past.length})</span>
        </h2>
        {past.length === 0 ? (
          <p className="text-sm text-zinc-500">还没有结束的投票。</p>
        ) : (
          <ul aria-label="历史投票" className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {past.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/groups/${id}/votes/${r.id}`}
                  className="flex items-center justify-between gap-3 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      第 {r.number} 轮{r.title && `《${r.title}》`}
                    </p>
                    <p className="text-xs text-zinc-500">
                      <LocalDate value={r.startedAt} /> ·{" "}
                      {r.endReason && END_REASON_TEXT[r.endReason]} ·{" "}
                      {new Set(r.ballots.map((b) => b.userId)).size} 人投票
                    </p>
                  </div>
                  <span className="shrink-0 text-sm">
                    {r.winner ? (
                      `🏆 ${r.winner.name}`
                    ) : (
                      <span className="text-zinc-400">无人投票</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
