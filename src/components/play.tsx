"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { FormState } from "@/lib/auth/actions";
import { checkInAction, checkOutAction } from "@/lib/play/actions";
import { formatDuration } from "@/lib/play/rules";
import type { Presence, TogetherDTO } from "@/lib/play/service";
import { GameCover } from "./games";
import { Alert, Avatar, Button } from "./ui";

/** Re-renders server data periodically so statuses stay current. */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

/** Minutes since `since`, ticking; rendered after mount to avoid clock skew. */
function Elapsed({ since }: { since: Date }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  return <>{formatDuration(now - new Date(since).getTime())}</>;
}

export function PresenceBadge({ presence }: { presence?: Presence }) {
  if (presence?.playing) {
    return (
      <span className="inline-flex max-w-full items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
        <span className="truncate">
          正在玩《{presence.playing.name}》{presence.playing.source === "MANUAL" && "（签到）"} ·{" "}
          <Elapsed since={presence.playing.since} />
        </span>
      </span>
    );
  }
  if (presence?.steamOnline) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-400">
        <span aria-hidden className="h-2 w-2 rounded-full bg-sky-500" />
        Steam 在线
      </span>
    );
  }
  return null;
}

/** Local "10月28日 21:05 – 22:40". */
function TimeRange({ start, end, live }: { start: Date; end: Date; live: boolean }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const day = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });
    const time = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const s = new Date(start);
    const e = new Date(end);
    const sameDay = s.toDateString() === e.toDateString();
    setText(
      `${day.format(s)} ${time.format(s)} – ${live ? "现在" : `${sameDay ? "" : `${day.format(e)} `}${time.format(e)}`}`,
    );
  }, [start, end, live]);
  return <time dateTime={new Date(start).toISOString()}>{text}</time>;
}

export function TogetherList({
  groupId,
  items,
  showGame = true,
  empty,
}: {
  groupId: string;
  items: TogetherDTO[];
  showGame?: boolean;
  empty: string;
}) {
  if (items.length === 0) return <p className="text-sm text-zinc-500">{empty}</p>;
  return (
    <ul aria-label="一起玩的记录" className="divide-y divide-zinc-200 dark:divide-zinc-800">
      {items.map((t) => (
        <li
          key={`${t.game.id}-${new Date(t.start).getTime()}`}
          className="flex items-center gap-3 py-3"
        >
          {showGame && (
            <Link href={`/groups/${groupId}/games/${t.game.id}`} className="shrink-0">
              <GameCover
                src={t.game.coverUrl}
                name={t.game.name}
                className="h-10 w-[86px] rounded text-base"
              />
            </Link>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="flex flex-wrap items-center gap-x-2 text-sm">
              {showGame && <span className="font-medium">{t.game.name}</span>}
              <span className="text-zinc-500">
                <TimeRange start={t.start} end={t.end} live={t.live} />
              </span>
              {t.live && (
                <span className="rounded bg-emerald-100 px-1.5 text-xs text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                  进行中
                </span>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {t.members.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400"
                >
                  <Avatar src={m.avatarUrl} name={m.displayName} size={18} />
                  {m.displayName}
                </span>
              ))}
            </div>
          </div>
          <span className="shrink-0 text-sm font-medium">
            {formatDuration(new Date(t.end).getTime() - new Date(t.start).getTime())}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PlayTotals({
  totals,
}: {
  totals: { user: { id: string; displayName: string; avatarUrl: string | null }; ms: number }[];
}) {
  if (totals.length === 0) return <p className="text-sm text-zinc-500">近 30 天没有群成员玩过。</p>;
  const max = totals[0].ms;
  return (
    <ul aria-label="成员游玩时长" className="space-y-2">
      {totals.map(({ user, ms }) => (
        <li key={user.id} className="flex items-center gap-2 text-sm">
          <Avatar src={user.avatarUrl} name={user.displayName} size={20} />
          <span className="w-24 shrink-0 truncate">{user.displayName}</span>
          <span className="h-2 flex-1 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800">
            <span
              className="block h-full rounded bg-indigo-500"
              style={{ width: `${Math.max(4, (ms / max) * 100)}%` }}
            />
          </span>
          <span className="w-28 shrink-0 text-right text-zinc-600 dark:text-zinc-400">
            {formatDuration(ms)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "开黑签到": manual play status for people without Steam detection. */
export function CheckInCard({
  groupId,
  games,
  current,
}: {
  groupId: string;
  games: { id: string; name: string }[];
  current: { gameId: string; name: string; since: Date } | null;
}) {
  const [gameId, setGameId] = useState(games[0]?.id ?? "");
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<FormState>) => start(async () => setState(await fn()));

  return (
    <div className="space-y-3">
      {state?.error && <Alert kind="error">{state.error}</Alert>}
      {state?.ok && <Alert kind="ok">{state.ok}</Alert>}
      {current ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            你正在玩《{current.name}》，已签到 <Elapsed since={current.since} />
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => checkOutAction(groupId))}
          >
            结束签到
          </Button>
        </div>
      ) : games.length === 0 ? (
        <p className="text-sm text-zinc-500">
          先在
          <Link href={`/groups/${groupId}/games`} className="text-indigo-600 hover:underline">
            游戏库
          </Link>
          添加游戏，就可以签到了。
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="签到的游戏"
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
            onClick={() => run(() => checkInAction(groupId, gameId))}
          >
            我在玩
          </Button>
        </div>
      )}
      <p className="text-xs text-zinc-500">
        关联 Steam 并公开游戏详情后会自动检测，不用签到。签到 6 小时后自动结束。
      </p>
    </div>
  );
}
