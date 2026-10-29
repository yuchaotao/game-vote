"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { FormState } from "@/lib/auth/actions";
import { withBase } from "@/lib/base-path";
import { replayFrames, type ReplayEvent } from "@/lib/votes/rules";
import {
  addCandidateAction,
  endRoundAction,
  removeCandidateAction,
  startRoundAction,
  toggleVoteAction,
} from "@/lib/votes/actions";
import { GameCover, ReviewSummary } from "./games";
import { Alert, Avatar, Button, Field } from "./ui";

type UserLite = { id: string; displayName: string; avatarUrl: string | null };
type GameLite = {
  id: string;
  name: string;
  coverUrl: string | null;
  source: "STEAM" | "IGDB" | "MANUAL";
  reviewPercent: number | null;
  reviewCount: number | null;
  reviewLabel: string | null;
  metacritic: number | null;
};

export type BoardItem = {
  game: GameLite;
  votes: number;
  rank: number;
  voters: UserLite[];
  addedBy: UserLite | null;
  canRemove: boolean;
};

function Status({ state }: { state: FormState }) {
  if (state?.error) return <Alert kind="error">{state.error}</Alert>;
  if (state?.ok) return <Alert kind="ok">{state.ok}</Alert>;
  return null;
}

/** Re-renders the page whenever any member changes this group's vote. */
export function LiveVotes({ groupId }: { groupId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const es = new EventSource(withBase(`/api/groups/${groupId}/events`));
    es.addEventListener("votes", () => {
      // Several clicks in a burst cause one refresh.
      clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    });
    return () => {
      clearTimeout(timer.current);
      es.close();
    };
  }, [groupId, router]);
  return null;
}

/** "2 小时 5 分钟后截止" in the viewer's clock; refreshes when it passes. */
export function Deadline({ at }: { at: Date }) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(at).getTime() - (now ?? 0);
  useEffect(() => {
    if (now !== null && ms <= 0) router.refresh();
  }, [ms, now, router]);
  if (now === null) return null;
  if (ms <= 0) return <span>已到截止时间</span>;
  const minutes = Math.ceil(ms / 60_000);
  const text =
    minutes < 60
      ? `${minutes} 分钟`
      : minutes < 48 * 60
        ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
        : `${Math.floor(minutes / 1440)} 天`;
  return (
    <span>
      {text}后截止（
      {new Date(at).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}）
    </span>
  );
}

export function StartRoundForm({ groupId }: { groupId: string }) {
  const [state, action, pending] = useActionState(startRoundAction.bind(null, groupId), undefined);
  const [local, setLocal] = useState("");
  // datetime-local is the viewer's local time; send an absolute ISO time.
  const iso = local ? new Date(local).toISOString() : "";
  return (
    <form action={action} className="space-y-3">
      <Status state={state} />
      <Field
        label="标题"
        name="title"
        maxLength={60}
        placeholder="例如：周五晚上玩什么"
        hint="可选"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="每人票数"
          name="maxVotes"
          type="number"
          min={1}
          max={10}
          defaultValue={3}
          hint="每个游戏最多投 1 票"
        />
        <div>
          <Field
            label="截止时间"
            type="datetime-local"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            hint="可选，到时自动结束"
          />
          <input type="hidden" name="deadline" value={iso} />
        </div>
      </div>
      <Button disabled={pending}>发起投票</Button>
    </form>
  );
}

export function VoteBoard({
  groupId,
  roundId,
  items,
  myVotes,
  maxVotes,
  open,
}: {
  groupId: string;
  roundId: string;
  items: BoardItem[];
  myVotes: string[];
  maxVotes: number;
  open: boolean;
}) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<FormState>) =>
    start(async () => {
      const res = await fn();
      // Successful votes speak for themselves; only surface problems.
      setState(res?.error ? res : undefined);
    });
  const top = Math.max(1, ...items.map((i) => i.votes));
  const left = maxVotes - myVotes.length;

  if (items.length === 0) {
    return (
      <p className="text-sm text-zinc-500">还没有候选游戏。从游戏库挑几个，或者直接添加新游戏。</p>
    );
  }
  return (
    <div className="space-y-3">
      {open && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
          你还剩 <strong>{left}</strong> / {maxVotes} 票
        </p>
      )}
      <Status state={state} />
      <ol aria-label="候选游戏" className="space-y-2">
        {items.map((item) => {
          const mine = myVotes.includes(item.game.id);
          return (
            <li
              key={item.game.id}
              aria-label={`第 ${item.rank} 名 ${item.game.name}`}
              // Phones: rank, cover and name on top; votes and the button get the
              // full width below. Wider: one row with the button on the right.
              className={`grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl border p-3 [grid-template-areas:'rank_cover_info_info'_'stats_stats_stats_action'] sm:[grid-template-areas:'rank_cover_info_action'_'rank_cover_stats_action'] ${
                mine
                  ? "border-indigo-400 bg-indigo-50/50 dark:border-indigo-700 dark:bg-indigo-950/30"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <span className="w-5 text-center text-base font-bold text-zinc-400 [grid-area:rank] sm:w-6 sm:text-lg">
                {item.rank}
              </span>
              <Link href={`/groups/${groupId}/games/${item.game.id}`} className="[grid-area:cover]">
                <GameCover
                  src={item.game.coverUrl}
                  name={item.game.name}
                  className="h-10 w-[86px] rounded text-sm sm:h-12 sm:w-[103px] sm:text-base"
                />
              </Link>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 [grid-area:info] sm:self-end">
                <span className="font-medium leading-snug break-words">{item.game.name}</span>
                <ReviewSummary game={item.game} />
              </div>
              <div className="min-w-0 space-y-1 [grid-area:stats] sm:self-start">
                <div className="flex items-center gap-2">
                  <span className="h-2 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
                    <span
                      className="block h-full rounded bg-indigo-500 transition-all duration-500"
                      style={{ width: `${(item.votes / top) * 100}%` }}
                    />
                  </span>
                  <span className="w-12 shrink-0 text-right text-sm font-semibold">
                    {item.votes} 票
                  </span>
                </div>
                {item.voters.length > 0 && (
                  <div className="flex flex-wrap gap-1" aria-label="投票的人">
                    {item.voters.map((v) => (
                      <span key={v.id} title={v.displayName}>
                        <Avatar src={v.avatarUrl} name={v.displayName} size={20} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {open && (
                <div className="flex items-center gap-3 self-center justify-self-end [grid-area:action] sm:flex-col sm:items-end sm:gap-1">
                  {item.canRemove && (
                    <button
                      type="button"
                      className="order-first text-xs text-zinc-400 hover:text-red-600 sm:order-last"
                      disabled={pending}
                      onClick={() =>
                        run(() => removeCandidateAction(groupId, roundId, item.game.id))
                      }
                    >
                      移除
                    </button>
                  )}
                  <Button
                    type="button"
                    variant={mine ? "primary" : "secondary"}
                    className="min-h-9 px-3 py-1.5"
                    aria-pressed={mine}
                    aria-label={`${mine ? "取消投票" : "投票"} ${item.game.name}`}
                    disabled={pending || (!mine && left <= 0)}
                    onClick={() => run(() => toggleVoteAction(groupId, roundId, item.game.id))}
                  >
                    {mine ? "✓ 已投" : "投一票"}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function AddFromLibrary({
  groupId,
  roundId,
  games,
}: {
  groupId: string;
  roundId: string;
  games: { id: string; name: string }[];
}) {
  const [gameId, setGameId] = useState(games[0]?.id ?? "");
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!games.some((g) => g.id === gameId)) setGameId(games[0]?.id ?? "");
  }, [games, gameId]);
  if (games.length === 0) {
    return <p className="text-sm text-zinc-500">游戏库里的游戏都已经是候选了。</p>;
  }
  return (
    <div className="space-y-2">
      <Status state={state} />
      <div className="flex gap-2">
        <select
          aria-label="从游戏库选择"
          value={gameId}
          onChange={(e) => setGameId(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        >
          {games.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          disabled={pending || !gameId}
          onClick={() =>
            start(async () => setState(await addCandidateAction(groupId, roundId, gameId)))
          }
        >
          加入候选
        </Button>
      </div>
    </div>
  );
}

export function EndRoundControls({ groupId, roundId }: { groupId: string; roundId: string }) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const end = (startNext: boolean, question: string) => {
    if (!confirm(question)) return;
    start(async () => setState(await endRoundAction(groupId, roundId, startNext)));
  };
  return (
    <div className="space-y-2">
      <Status state={state} />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={pending}
          onClick={() => end(true, "结束这轮投票，并用相同的候选开启下一轮？")}
        >
          结束并开启下一轮
        </Button>
        <button
          type="button"
          disabled={pending}
          onClick={() => end(false, "结束这轮投票？")}
          className="text-xs text-zinc-400 underline-offset-2 hover:text-zinc-600 hover:underline"
        >
          仅结束投票
        </button>
      </div>
    </div>
  );
}

function describe(e: ReplayEvent, users: Record<string, string>, games: Record<string, string>) {
  const who = (e.userId && users[e.userId]) || "某人";
  const game = games[e.gameId] ?? "某个游戏";
  switch (e.kind) {
    case "CANDIDATE":
      return `${who} 加入候选《${game}》`;
    case "CAST":
      return `${who} 投给了《${game}》`;
    case "RETRACT":
      return `${who} 取消了对《${game}》的投票`;
    case "REMOVED":
      return `${who} 移除了候选《${game}》`;
  }
}

/** Steps through a round's history: who did what, and the ranking after each step. */
export function RoundReplay({
  events,
  users,
  games,
}: {
  events: ReplayEvent[];
  users: Record<string, string>;
  games: Record<string, string>;
}) {
  const frames = useMemo(() => replayFrames(events), [events]);
  const [step, setStep] = useState(frames.length - 1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    if (step >= frames.length - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setStep((s) => s + 1), 900);
    return () => clearTimeout(t);
  }, [playing, step, frames.length]);

  if (frames.length === 0) return <p className="text-sm text-zinc-500">这轮还没有任何记录。</p>;
  const frame = frames[Math.max(0, step)];
  const top = Math.max(1, ...frame.standings.map((s) => s.votes));

  return (
    <div role="region" className="space-y-3" aria-label="投票回放">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          className="px-3 py-1.5"
          onClick={() => {
            if (step >= frames.length - 1) setStep(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? "暂停" : "▶ 回放"}
        </Button>
        <input
          type="range"
          aria-label="回放进度"
          min={0}
          max={frames.length - 1}
          value={step}
          onChange={(e) => {
            setPlaying(false);
            setStep(Number(e.target.value));
          }}
          className="flex-1"
        />
        <span className="w-16 shrink-0 text-right text-xs text-zinc-500">
          {step + 1} / {frames.length}
        </span>
      </div>
      <p className="text-sm" aria-live="polite">
        <time className="mr-2 text-zinc-500" dateTime={frame.at}>
          {new Date(frame.at).toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" })}
        </time>
        {describe(frame.event, users, games)}
      </p>
      <ol aria-label="当时的排名" className="space-y-1.5">
        {frame.standings.map((s) => (
          <li key={s.gameId} className="flex items-center gap-2 text-sm">
            <span className="w-5 shrink-0 text-center text-zinc-400">{s.rank}</span>
            <span className="w-40 shrink-0 truncate">{games[s.gameId] ?? s.gameId}</span>
            <span className="h-2 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
              <span
                className="block h-full rounded bg-indigo-500 transition-all duration-500"
                style={{ width: `${(s.votes / top) * 100}%` }}
              />
            </span>
            <span className="w-10 shrink-0 text-right">{s.votes} 票</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
