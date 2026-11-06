import Link from "next/link";
import { notFound } from "next/navigation";
import { GambleActions, RevealConfetti } from "@/components/anonymous";
import { AddGamePanel, GameCover, LocalDate } from "@/components/games";
import { Card } from "@/components/ui";
import {
  AddFromLibrary,
  ConfirmVotes,
  Deadline,
  ManageRound,
  RoundReplay,
  VoteBoard,
  type BoardItem,
} from "@/components/votes";
import { requireUser } from "@/lib/auth/session";
import { igdbEnabled, listLibrary } from "@/lib/games/service";
import { getGroupForMember } from "@/lib/groups/service";
import { exposures, myGambles, takePeek } from "@/lib/votes/gamble";
import { endReasonText, resultsHidden } from "@/lib/votes/rules";
import { firstRevealVisit, getRound, peekers, roundEvents } from "@/lib/votes/service";
import { getT } from "@/lib/i18n/server";
import { Trans } from "@/components/i18n";

export async function generateMetadata() {
  const t = await getT();
  return { title: `${t("投票")} · Game Vote` };
}

export default async function RoundPage({
  params,
}: {
  params: Promise<{ id: string; roundId: string }>;
}) {
  const t = await getT();
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
  const hiddenToMe = resultsHidden(round, iPeeked);
  // A won 赌一把 shows the results on this one page load (#57).
  const peekNow = hiddenToMe && (await takePeek(roundId, user.id));
  const hidden = hiddenToMe && !peekNow;
  const [gambles, exposed] = await Promise.all([
    hidden ? myGambles(roundId, user.id) : { peek: 0, swap: 0 },
    round.anonymous ? exposures(roundId) : [],
  ]);
  const myLuck = group.members.find((m) => m.userId === user.id)?.luck ?? 50;
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
          voters: round.ballots
            .filter((b) => b.gameId === s.gameId)
            .map((b) => ({ ...b.user, count: b.count })),
          addedBy: c.addedBy,
          canRemove: s.votes === 0 && (c.addedById === user.id || group.ownerId === user.id),
        };
      });
  const myVotes = Object.fromEntries(
    round.ballots.filter((b) => b.userId === user.id).map((b) => [b.gameId, b.count]),
  );

  const [library, events] = await Promise.all([
    open ? listLibrary(id) : Promise.resolve([]),
    open ? Promise.resolve([]) : roundEvents(roundId),
  ]);
  const notCandidates = library
    .filter((e) => !byGame.has(e.gameId))
    .map((e) => ({ id: e.gameId, name: e.game.name }));

  const label = round.title
    ? t("第 {n} 轮《{title}》", { n: round.number, title: round.title })
    : t("第 {n} 轮投票", { n: round.number });
  const voters = new Set(round.ballots.map((b) => b.userId)).size;
  const peekNames = peeked.map((p) => p.user.displayName).join("、");

  return (
    <div className="space-y-6">
      {celebrate && <RevealConfetti delaySeconds={(items.length - 1) * 0.45 + 0.3} />}
      <Link href={`/groups/${id}/votes`} className="text-sm text-zinc-500 hover:underline">
        {t("← 全部投票")}
      </Link>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-bold">{label}</h2>
            <p className="text-sm text-zinc-500">
              <Trans
                text="{who} 于 {date} 发起"
                values={{
                  who: round.startedBy?.displayName ?? t("某人"),
                  date: <LocalDate value={round.startedAt} />,
                }}
              />{" "}
              · {t("每人最多 {n} 票", { n: round.maxVotes })}
              {round.repeatVotes ? t("（可重复投同一个游戏）") : ""} ·{" "}
              {t("{voted} / {total} 人已投", { voted: voters, total: group.members.length })}
              {open && round.confirmations.length > 0
                ? ` · ${t("{n} 人已确认", { n: round.confirmations.length })}`
                : ""}
            </p>
            {open && round.deadline && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {round.anonymous ? t("🙈 匿名投票 · ") : ""}
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
                ? t("匿名进行中")
                : t("进行中")
              : round.anonymous
                ? t("已揭榜")
                : t("已结束")}
          </span>
        </div>

        {open && round.anonymous && (
          <section
            aria-label={t("匿名投票")}
            className="space-y-2 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50"
          >
            {peekNow ? (
              <p>
                {t("🎲 赌赢了！这些结果只显示这一次，刷新或离开后会重新隐藏，没人知道你看过。")}
              </p>
            ) : hidden ? (
              <>
                <p>{t("🙈 揭榜前不显示票数和排名，到点自动揭晓。你投了哪些只有你自己看得到。")}</p>
                <GambleActions
                  groupId={id}
                  roundId={roundId}
                  luck={myLuck}
                  limit={round.gambleLimit}
                  peekLeft={round.gambleLimit - gambles.peek}
                  swapLeft={round.gambleLimit - gambles.swap}
                  hasVotes={Object.keys(myVotes).length > 0}
                />
              </>
            ) : (
              <p>{t("👀 你偷看了结果，群里的人都知道了。")}</p>
            )}
            {peekNames && (
              <p className="text-xs text-zinc-500">
                {t("👀 偷看过：{names}", { names: peekNames })}
              </p>
            )}
            {exposed.length > 0 && (
              <ul aria-label={t("被抓到的小动作")} className="space-y-0.5 text-xs text-zinc-500">
                {exposed.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
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
                  {t("🏆 胜出：")}
                  <strong>{round.winner.name}</strong>
                </p>
              </>
            ) : (
              <p>{t("没有人投票")}</p>
            )}
            <p className="ml-auto text-xs text-zinc-500">
              {round.endedBy && `${round.endedBy.displayName} · `}
              {round.endReason && t(endReasonText(round.endReason, round.anonymous))}
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
          <p className="text-xs text-zinc-500">
            {t("👀 揭榜前偷看过：{names}", { names: peekNames })}
          </p>
        )}
        {!open && exposed.length > 0 && (
          <ul aria-label={t("被抓到的小动作")} className="space-y-0.5 text-xs text-zinc-500">
            {exposed.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}

        <VoteBoard
          groupId={id}
          roundId={roundId}
          items={items}
          myVotes={myVotes}
          maxVotes={round.maxVotes}
          open={open}
          hidden={hidden}
          repeat={round.repeatVotes}
          celebrate={celebrate}
        />
        {open && (
          <div className="flex flex-wrap items-start gap-3">
            <ConfirmVotes
              groupId={id}
              roundId={roundId}
              confirmed={round.confirmations.some((c) => c.userId === user.id)}
              hasVotes={Object.keys(myVotes).length > 0}
            />
            <ManageRound groupId={id} roundId={roundId} />
          </div>
        )}
      </Card>

      {open && (
        <>
          <Card className="space-y-3">
            <h3 className="font-semibold">{t("从游戏库添加候选")}</h3>
            <AddFromLibrary groupId={id} roundId={roundId} games={notCandidates} />
          </Card>
          <AddGamePanel groupId={id} igdb={igdbEnabled()} roundId={roundId} />
        </>
      )}

      {!open && (
        <Card className="space-y-3">
          <h3 className="font-semibold">{t("投票回放")}</h3>
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
