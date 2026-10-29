import Link from "next/link";
import { notFound } from "next/navigation";
import { PeekButton, RevealConfetti } from "@/components/anonymous";
import { AddGamePanel, GameCover, LocalDate } from "@/components/games";
import { Card } from "@/components/ui";
import {
  AddFromLibrary,
  Deadline,
  EndRoundControls,
  RoundReplay,
  VoteBoard,
  type BoardItem,
} from "@/components/votes";
import { requireUser } from "@/lib/auth/session";
import { igdbEnabled, listLibrary } from "@/lib/games/service";
import { getGroupForMember } from "@/lib/groups/service";
import { endReasonText, resultsHidden } from "@/lib/votes/rules";
import { firstRevealVisit, getRound, peekers, roundEvents } from "@/lib/votes/service";

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

  const peeked = round.anonymous ? await peekers(roundId) : [];
  const iPeeked = peeked.some((p) => p.userId === user.id);
  // Anonymous and still open: no counts, ranks or voters, and candidates in the
  // order they were added (the ranked order would give it away).
  const hidden = resultsHidden(round, iPeeked);
  // The reveal effect plays the first time each member opens the result.
  const celebrate = round.anonymous && !open && (await firstRevealVisit(roundId, user.id));

  const byGame = new Map(round.candidates.map((c) => [c.gameId, c]));
  const items: BoardItem[] = hidden
    ? round.candidates.map((c, i) => ({
        game: c.game,
        votes: 0,
        rank: i + 1,
        voters: [],
        addedBy: c.addedBy,
        // Not "only without votes": that would tell. The server still refuses.
        canRemove: c.addedById === user.id || group.ownerId === user.id,
      }))
    : standings.map((s) => {
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
  const peekNames = peeked.map((p) => p.user.displayName).join("、");

  return (
    <div className="space-y-6">
      {celebrate && <RevealConfetti delaySeconds={(items.length - 1) * 0.45 + 0.3} />}
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
                {round.anonymous ? "🙈 匿名投票 · " : ""}
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
            {open
              ? round.anonymous
                ? "匿名进行中"
                : "进行中"
              : round.anonymous
                ? "已揭榜"
                : "已结束"}
          </span>
        </div>

        {open && round.anonymous && (
          <section
            aria-label="匿名投票"
            className="space-y-2 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50"
          >
            {hidden ? (
              <>
                <p>🙈 揭榜前不显示票数和排名，到点自动揭晓。你投了哪些只有你自己看得到。</p>
                <PeekButton groupId={id} roundId={roundId} />
              </>
            ) : (
              <p>👀 你偷看了结果，群里的人都知道了。</p>
            )}
            {peekNames && <p className="text-xs text-zinc-500">👀 偷看过：{peekNames}</p>}
          </section>
        )}

        {!open && (
          <div
            className={`flex items-center gap-3 rounded-lg bg-amber-50 p-3 dark:bg-amber-950/40 ${
              celebrate ? "reveal-winner" : ""
            }`}
            style={
              celebrate
                ? ({ "--d": `${(items.length - 1) * 0.45 + 0.3}s` } as React.CSSProperties)
                : undefined
            }
          >
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
              {round.endReason && endReasonText(round.endReason, round.anonymous)}
              {round.endedAt && (
                <>
                  {" · "}
                  <LocalDate value={round.endedAt} />
                </>
              )}
            </p>
          </div>
        )}
        {!open && peekNames && (
          <p className="text-xs text-zinc-500">👀 揭榜前偷看过：{peekNames}</p>
        )}

        <VoteBoard
          groupId={id}
          roundId={roundId}
          items={items}
          myVotes={myVotes}
          maxVotes={round.maxVotes}
          open={open}
          hidden={hidden}
          celebrate={celebrate}
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
