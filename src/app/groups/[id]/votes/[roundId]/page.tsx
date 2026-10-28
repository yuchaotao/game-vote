import Link from "next/link";
import { notFound } from "next/navigation";
import { AddGamePanel, GameCover, LocalDate } from "@/components/games";
import { Card } from "@/components/ui";
import {
  AddFromLibrary,
  Deadline,
  EndRoundControls,
  LiveVotes,
  RoundReplay,
  VoteBoard,
  type BoardItem,
} from "@/components/votes";
import { requireUser } from "@/lib/auth/session";
import { igdbEnabled, listLibrary } from "@/lib/games/service";
import { getGroupForMember } from "@/lib/groups/service";
import { END_REASON_TEXT } from "@/lib/votes/rules";
import { getRound, roundEvents } from "@/lib/votes/service";

export const metadata = { title: "投票 · Game Vote" };

export default async function RoundPage({
  params,
}: {
  params: Promise<{ id: string; roundId: string }>;
}) {
  const { id, roundId } = await params;
  const user = await requireUser();
  const group = await getGroupForMember(id, user.id);
  if (!group) notFound();
  const data = await getRound(id, roundId);
  if (!data) notFound();
  const { round, standings } = data;
  const open = round.status === "OPEN";

  const byGame = new Map(round.candidates.map((c) => [c.gameId, c]));
  const items: BoardItem[] = standings.map((s) => {
    const c = byGame.get(s.gameId)!;
    return {
      game: c.game,
      votes: s.votes,
      rank: s.rank,
      voters: round.ballots.filter((b) => b.gameId === s.gameId).map((b) => b.user),
      addedBy: c.addedBy,
      canRemove: s.votes === 0 && (c.addedById === user.id || group.ownerId === user.id),
    };
  });
  const myVotes = round.ballots.filter((b) => b.userId === user.id).map((b) => b.gameId);

  const [library, events] = await Promise.all([
    open ? listLibrary(id) : Promise.resolve([]),
    open ? Promise.resolve([]) : roundEvents(roundId),
  ]);
  const notCandidates = library
    .filter((e) => !byGame.has(e.gameId))
    .map((e) => ({ id: e.gameId, name: e.game.name }));

  const label = `第 ${round.number} 轮${round.title ? `《${round.title}》` : "投票"}`;
  const voters = new Set(round.ballots.map((b) => b.userId)).size;

  return (
    <div className="space-y-6">
      <LiveVotes groupId={id} />
      <Link href={`/groups/${id}/votes`} className="text-sm text-zinc-500 hover:underline">
        ← 全部投票
      </Link>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold">{label}</h2>
            <p className="text-sm text-zinc-500">
              {round.startedBy?.displayName ?? "某人"} 于 <LocalDate value={round.startedAt} /> 发起
              · 每人最多 {round.maxVotes} 票 · {voters} / {group.members.length} 人已投
            </p>
            {open && round.deadline && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                <Deadline at={round.deadline} />
              </p>
            )}
          </div>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              open
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            }`}
          >
            {open ? "进行中" : "已结束"}
          </span>
        </div>

        {!open && (
          <div className="flex items-center gap-3 rounded-lg bg-amber-50 p-3 dark:bg-amber-950/40">
            {round.winner ? (
              <>
                <GameCover
                  src={round.winner.coverUrl}
                  name={round.winner.name}
                  className="h-12 w-[103px] rounded text-base"
                />
                <p>
                  🏆 胜出：<strong>{round.winner.name}</strong>
                </p>
              </>
            ) : (
              <p>没有人投票</p>
            )}
            <p className="ml-auto text-xs text-zinc-500">
              {round.endedBy && `${round.endedBy.displayName} · `}
              {round.endReason && END_REASON_TEXT[round.endReason]}
              {round.endedAt && (
                <>
                  {" · "}
                  <LocalDate value={round.endedAt} />
                </>
              )}
            </p>
          </div>
        )}

        <VoteBoard
          groupId={id}
          roundId={roundId}
          items={items}
          myVotes={myVotes}
          maxVotes={round.maxVotes}
          open={open}
        />
        {open && <EndRoundControls groupId={id} roundId={roundId} />}
      </Card>

      {open && (
        <>
          <Card className="space-y-3">
            <h3 className="font-semibold">从游戏库添加候选</h3>
            <AddFromLibrary groupId={id} roundId={roundId} games={notCandidates} />
          </Card>
          <AddGamePanel groupId={id} igdb={igdbEnabled()} roundId={roundId} />
        </>
      )}

      {!open && (
        <Card className="space-y-3">
          <h3 className="font-semibold">投票回放</h3>
          <RoundReplay
            events={events}
            users={Object.fromEntries(group.members.map((m) => [m.user.id, m.user.displayName]))}
            games={Object.fromEntries([
              ...events.map((e) => [e.gameId, e.game.name]),
              ...round.candidates.map((c) => [c.gameId, c.game.name]),
            ])}
          />
        </Card>
      )}
    </div>
  );
}
