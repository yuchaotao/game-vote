"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import type { Game } from "@prisma/client";
import type { FormState } from "@/lib/auth/actions";
import {
  addIgdbGameAction,
  addManualGameAction,
  addSteamGameAction,
  lookupIgdbAction,
  lookupSteamAction,
  refreshGameAction,
  removeFromLibraryAction,
  updateManualGameAction,
} from "@/lib/games/actions";
import type { Hotness } from "@/lib/games/hotness";
import {
  formatPrice,
  isMultiplayer,
  normalizeGameName,
  sortLibrary,
  type LibrarySort,
} from "@/lib/games/rules";
import type { IgdbLookup, LibraryEntry, SteamLookup } from "@/lib/games/service";
import { Alert, Avatar, Button, Field } from "./ui";

function Status({ state }: { state: FormState }) {
  if (state?.error) return <Alert kind="error">{state.error}</Alert>;
  if (state?.ok) return <Alert kind="ok">{state.ok}</Alert>;
  return null;
}

const textareaClass =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950";

const chipClass =
  "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

/** Renders a date in the viewer's timezone, after mount (server and browser zones differ). */
export function LocalDate({ value }: { value: Date | string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(new Date(value).toLocaleDateString("zh-CN"));
  }, [value]);
  return <time dateTime={new Date(value).toISOString()}>{text}</time>;
}

/** Cover image with a lettered placeholder; covers come from Steam or a URL members typed in. */
export function GameCover({
  src,
  name,
  className = "",
}: {
  src: string | null;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div
        aria-hidden
        className={`flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 text-3xl font-bold text-white ${className}`}
      >
        {name.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote hosts
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  );
}

type GameInfo = Pick<
  Game,
  | "isFree"
  | "priceFinal"
  | "priceInitial"
  | "priceCurrency"
  | "discountPercent"
  | "reviewPercent"
  | "reviewCount"
  | "reviewLabel"
  | "metacritic"
  | "source"
>;

export function ReviewSummary({ game }: { game: GameInfo }) {
  if (game.reviewPercent !== null) {
    const tone =
      game.reviewPercent >= 80
        ? "text-sky-600 dark:text-sky-400"
        : game.reviewPercent >= 40
          ? "text-amber-600 dark:text-amber-400"
          : "text-red-600 dark:text-red-400";
    return (
      <span className={`text-sm font-medium ${tone}`}>
        {game.reviewLabel ?? "好评率"} {game.reviewPercent}
        {game.source === "IGDB" ? "" : "%"}
        {game.reviewCount !== null && (
          <span className="ml-1 font-normal text-zinc-500">
            （{game.reviewCount.toLocaleString("zh-CN")}{" "}
            {game.source === "IGDB" ? "人评分" : "篇评测"}）
          </span>
        )}
      </span>
    );
  }
  if (game.metacritic !== null) {
    return <span className="text-sm font-medium">Metacritic {game.metacritic}</span>;
  }
  if (game.reviewCount !== null) {
    return (
      <span className="text-sm text-zinc-500">
        {game.reviewCount.toLocaleString("zh-CN")} 人推荐
      </span>
    );
  }
  return <span className="text-sm text-zinc-400">暂无评价</span>;
}

export function PriceTag({ game }: { game: GameInfo }) {
  if (game.isFree) return <span className="text-sm font-medium text-emerald-600">免费</span>;
  if (game.priceFinal === null || !game.priceCurrency) return null;
  return (
    <span className="flex items-center gap-1.5 text-sm">
      {game.discountPercent && (
        <span className="rounded bg-lime-600 px-1 text-xs font-bold text-white">
          -{game.discountPercent}%
        </span>
      )}
      {game.discountPercent && game.priceInitial !== null && (
        <s className="text-xs text-zinc-400">
          {formatPrice(game.priceInitial, game.priceCurrency)}
        </s>
      )}
      <span className="font-medium">{formatPrice(game.priceFinal, game.priceCurrency)}</span>
    </span>
  );
}

const SOURCE_LABEL: Record<Game["source"], string> = {
  STEAM: "Steam",
  IGDB: "IGDB",
  MANUAL: "手动添加",
};

function GameCard({ entry, groupId, hot }: { entry: LibraryEntry; groupId: string; hot: number }) {
  const g = entry.game;
  return (
    <li>
      <Link
        href={`/groups/${groupId}/games/${g.id}`}
        className="group flex h-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition hover:border-indigo-400 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
      >
        <GameCover src={g.coverUrl} name={g.name} className="aspect-[460/215] w-full" />
        <div className="flex flex-1 flex-col gap-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight group-hover:text-indigo-600">{g.name}</h3>
            <span className="flex shrink-0 items-center gap-2 text-xs text-zinc-400">
              {hot > 0 && (
                <span title="热度" className="font-medium text-orange-600 dark:text-orange-400">
                  🔥 {hot}
                </span>
              )}
              {SOURCE_LABEL[g.source]}
            </span>
          </div>
          <ReviewSummary game={g} />
          {g.genres.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {g.genres.slice(0, 3).map((x) => (
                <span key={x} className={chipClass}>
                  {x}
                </span>
              ))}
            </div>
          )}
          {g.features.length > 0 && (
            <p className="text-xs text-zinc-500">{g.features.slice(0, 4).join(" · ")}</p>
          )}
          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            <PriceTag game={g} />
            <span className="ml-auto truncate text-xs text-zinc-400">
              {entry.addedBy ? `${entry.addedBy.displayName} 添加` : ""}
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}

const SORTS: { value: LibrarySort; label: string }[] = [
  { value: "hot", label: "热度" },
  { value: "rating", label: "评分" },
  { value: "recent", label: "最近添加" },
  { value: "name", label: "名称" },
];

const selectClass =
  "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950";

export function GameLibrary({
  groupId,
  entries,
  hot,
}: {
  groupId: string;
  entries: LibraryEntry[];
  hot: Record<string, Hotness>;
}) {
  const [sort, setSort] = useState<LibrarySort>("hot");
  const [filter, setFilter] = useState("");
  const [genre, setGenre] = useState("");
  const [source, setSource] = useState<"" | Game["source"]>("");
  const [multiplayer, setMultiplayer] = useState(false);

  const genres = useMemo(
    () =>
      [...new Set(entries.flatMap((e) => e.game.genres))].sort((a, b) =>
        a.localeCompare(b, "zh-CN"),
      ),
    [entries],
  );
  const sources = useMemo(() => [...new Set(entries.map((e) => e.game.source))], [entries]);

  const shown = useMemo(() => {
    const q = normalizeGameName(filter);
    const flat = entries.map((e) => ({
      ...e.game,
      addedAt: e.addedAt,
      hot: hot[e.gameId]?.score ?? 0,
      entry: e,
    }));
    const matching = flat.filter(
      (g) =>
        (!q ||
          [g.name, ...g.genres, ...g.features].some((s) => normalizeGameName(s).includes(q))) &&
        (!genre || g.genres.includes(genre)) &&
        (!source || g.source === source) &&
        (!multiplayer || isMultiplayer(g.features)),
    );
    return sortLibrary(matching, sort).map((g) => g.entry);
  }, [entries, hot, sort, filter, genre, source, multiplayer]);

  if (entries.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
        游戏库还是空的。搜索 Steam 或手动添加第一个游戏吧。
      </p>
    );
  }
  return (
    <section className="space-y-3" aria-label="游戏列表">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="在游戏库中查找"
          placeholder="在游戏库中查找（名称、类型）"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className={`${textareaClass} max-w-xs`}
        />
        <label className="ml-auto flex items-center gap-2 text-sm text-zinc-500">
          排序
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as LibrarySort)}
            className={selectClass}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {genres.length > 0 && (
          <select
            aria-label="按类型筛选"
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className={selectClass}
          >
            <option value="">全部类型</option>
            {genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
        {sources.length > 1 && (
          <select
            aria-label="按来源筛选"
            value={source}
            onChange={(e) => setSource(e.target.value as "" | Game["source"])}
            className={selectClass}
          >
            <option value="">全部来源</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={multiplayer}
            onChange={(e) => setMultiplayer(e.target.checked)}
          />
          只看能一起玩的
        </label>
        <span className="ml-auto text-zinc-500">
          {shown.length === entries.length
            ? `共 ${entries.length} 个`
            : `${shown.length} / ${entries.length} 个`}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-zinc-500">没有匹配的游戏</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {shown.map((e) => (
            <GameCard key={e.gameId} entry={e} groupId={groupId} hot={hot[e.gameId]?.score ?? 0} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Where a game's hot score comes from (detail page). */
export function HotnessBreakdown({ hot }: { hot: Hotness }) {
  const parts: [string, number][] = [
    ["群成员游玩", hot.play],
    ["一起玩加成", hot.together],
    ["投票", hot.votes],
    ["新加入", hot.fresh],
  ];
  return (
    <div className="space-y-2">
      <p className="text-2xl font-bold">
        🔥 {hot.score}
        <span className="ml-2 text-sm font-normal text-zinc-500">近 14 天，越近权重越高</span>
      </p>
      <dl aria-label="热度构成" className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {parts.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 sm:block">
            <dt className="text-zinc-500">{label}</dt>
            <dd className="font-medium">{Math.round(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type ResultItem = {
  key: string;
  name: string;
  imageUrl: string | null;
  detail: string | null;
  note?: string;
  added: boolean;
};

/** Search results with an "add" button each (Steam or IGDB). */
function ResultList({
  label,
  items,
  empty,
  onAdd,
}: {
  label: string;
  items: ResultItem[];
  empty: string;
  onAdd: (key: string) => Promise<FormState>;
}) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  if (items.length === 0) return <p className="text-sm text-zinc-500">{empty}</p>;
  return (
    <div className="space-y-2">
      {error && <Alert kind="error">{error}</Alert>}
      <ul aria-label={label} className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {items.map((r) => (
          <li key={r.key} className="flex items-center gap-3 py-2">
            <GameCover
              src={r.imageUrl}
              name={r.name}
              className="h-10 w-[86px] shrink-0 rounded text-base"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{r.name}</p>
              {(r.detail || r.note) && (
                <p className="truncate text-xs text-zinc-500">
                  {r.detail}
                  {r.note && <span className="ml-2 text-sky-600 dark:text-sky-400">{r.note}</span>}
                </p>
              )}
            </div>
            {r.added ? (
              <span className="text-xs text-zinc-500">已在库中</span>
            ) : (
              <Button
                type="button"
                className="px-3 py-1.5"
                aria-label={`添加 ${r.name}`}
                disabled={pending}
                onClick={() => {
                  setBusy(r.key);
                  start(async () => {
                    const res = await onAdd(r.key);
                    setBusy(undefined);
                    setError(res?.error);
                  });
                }}
              >
                {busy === r.key ? "添加中…" : "添加"}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

type Source = "steam" | "igdb";

const SOURCES: Record<Source, { tab: string; label: string; placeholder: string }> = {
  steam: {
    tab: "Steam",
    label: "搜索 Steam 或粘贴链接",
    placeholder: "搜索 Steam，或粘贴 Steam 商店链接",
  },
  igdb: {
    tab: "其他平台（IGDB）",
    label: "搜索 IGDB",
    placeholder: "搜索 EA、Battle.net、主机等平台的游戏（英文名更准）",
  },
};

export function AddGamePanel({ groupId, igdb }: { groupId: string; igdb: boolean }) {
  const [source, setSource] = useState<Source>("steam");
  const [query, setQuery] = useState("");
  const [steam, setSteam] = useState<SteamLookup>();
  const [igdbLookup, setIgdbLookup] = useState<IgdbLookup>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [manual, setManual] = useState(false);
  const [pending, start] = useTransition();

  const switchTo = (s: Source) => {
    setSource(s);
    setError(undefined);
    setNotice(undefined);
  };

  const added = (res: FormState, mark: () => void) => {
    if (res?.ok) {
      setNotice(res.ok);
      mark();
    }
    return res;
  };

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">添加游戏</h2>
        {igdb && (
          <div role="tablist" aria-label="游戏来源" className="flex gap-1 text-sm">
            {(Object.keys(SOURCES) as Source[]).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={source === s}
                onClick={() => switchTo(s)}
                className={`rounded-lg px-3 py-1 ${
                  source === s
                    ? "bg-indigo-600 text-white"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {SOURCES[s].tab}
              </button>
            ))}
          </div>
        )}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setNotice(undefined);
          start(async () => {
            if (source === "steam") {
              const res = await lookupSteamAction(groupId, query);
              setError("error" in res ? res.error : undefined);
              setSteam("error" in res ? undefined : res);
            } else {
              const res = await lookupIgdbAction(groupId, query);
              setError("error" in res ? res.error : undefined);
              setIgdbLookup("error" in res ? undefined : res);
            }
          });
        }}
      >
        <input
          aria-label={SOURCES[source].label}
          placeholder={SOURCES[source].placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={textareaClass}
        />
        <Button disabled={pending || !query.trim()} className="shrink-0">
          {pending ? "查找中…" : "查找"}
        </Button>
      </form>
      {notice && <Alert kind="ok">{notice}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {source === "steam" && steam && (
        <ResultList
          label="Steam 搜索结果"
          empty="Steam 上没有找到相关游戏，可以试试英文名、其他平台搜索，或手动添加。"
          items={steam.results.map((r) => ({
            key: r.appId,
            name: r.name,
            imageUrl: r.imageUrl,
            detail:
              r.priceFinal !== null && r.priceCurrency
                ? formatPrice(r.priceFinal, r.priceCurrency)
                : null,
            added: steam.inLibrary.includes(r.appId),
          }))}
          onAdd={async (appId) =>
            added(await addSteamGameAction(groupId, appId), () =>
              setSteam({ ...steam, inLibrary: [...steam.inLibrary, appId] }),
            )
          }
        />
      )}
      {source === "igdb" && igdbLookup && (
        <ResultList
          label="IGDB 搜索结果"
          empty="IGDB 上没有找到相关游戏，可以试试英文名，或手动添加。"
          items={igdbLookup.results.map((r) => ({
            key: r.igdbId,
            name: r.name,
            imageUrl: r.imageUrl,
            detail: [r.year, r.platforms.join(" · ")].filter(Boolean).join("　") || null,
            note: r.steamAppId ? "Steam 上也有，将按 Steam 版添加" : undefined,
            added: igdbLookup.inLibrary.includes(r.igdbId),
          }))}
          onAdd={async (igdbId) =>
            added(await addIgdbGameAction(groupId, igdbId), () =>
              setIgdbLookup({ ...igdbLookup, inLibrary: [...igdbLookup.inLibrary, igdbId] }),
            )
          }
        />
      )}
      <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <button
          type="button"
          aria-expanded={manual}
          onClick={() => {
            setManual((m) => !m);
            setNotice(undefined); // the manual form reports its own result
          }}
          className="text-sm text-indigo-600 hover:underline"
        >
          {manual ? "收起手动添加" : "都找不到？手动添加"}
        </button>
        {manual && (
          <div className="mt-3">
            <ManualGameForm groupId={groupId} />
          </div>
        )}
      </div>
    </section>
  );
}

function TextArea({
  label,
  hint,
  ...props
}: React.ComponentProps<"textarea"> & { label: string; hint?: string }) {
  const id = `ta-${props.name}`;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && <span className="text-xs text-zinc-500">{hint}</span>}
      </div>
      <textarea id={id} className={textareaClass} {...props} />
    </div>
  );
}

/** Add (no `game`) or edit a manual game. */
export function ManualGameForm({
  groupId,
  game,
  onSaved,
}: {
  groupId: string;
  game?: Game;
  onSaved?: () => void;
}) {
  const action = game
    ? updateManualGameAction.bind(null, groupId, game.id)
    : addManualGameAction.bind(null, groupId);
  const [state, formAction, pending] = useActionState(action, undefined);
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    if (!state?.ok) return;
    if (game) onSaved?.();
    else setFormKey((k) => k + 1); // clear the form for the next game
  }, [state, game, onSaved]);

  return (
    <form key={formKey} action={formAction} className="space-y-3">
      <Status state={state} />
      <Field label="游戏名" name="name" required maxLength={100} defaultValue={game?.name} />
      <Field
        label="平台 / 启动器"
        name="platforms"
        hint="逗号分隔，如 EA App, PC"
        defaultValue={game?.platforms.join(", ")}
      />
      <Field
        label="类型"
        name="genres"
        hint="逗号分隔，如 射击, 战术"
        defaultValue={game?.genres.join(", ")}
      />
      <Field
        label="游玩方式"
        name="features"
        hint="逗号分隔，如 多人, 在线合作"
        defaultValue={game?.features.join(", ")}
      />
      <Field
        label="封面图片地址"
        name="coverUrl"
        type="url"
        hint="可选，https:// 开头"
        defaultValue={game?.coverUrl ?? ""}
      />
      <Field
        label="商店 / 官网链接"
        name="storeUrl"
        type="url"
        hint="可选"
        defaultValue={game?.storeUrl ?? ""}
      />
      <TextArea
        label="简介"
        name="description"
        rows={3}
        maxLength={2000}
        hint="可选"
        defaultValue={game?.description}
      />
      <Button disabled={pending}>{game ? "保存修改" : "添加到游戏库"}</Button>
    </form>
  );
}

/** Detail-page controls: refresh (Steam), edit (manual), remove. */
export function GameDetailActions({
  groupId,
  game,
  canManage,
}: {
  groupId: string;
  game: Game;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<FormState>) => start(async () => setState(await fn()));

  return (
    <div className="space-y-3">
      <Status state={state} />
      <div className="flex flex-wrap gap-2">
        {(game.source === "STEAM" || game.source === "IGDB") && (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => refreshGameAction(groupId, game.id))}
          >
            从 {game.source === "IGDB" ? "IGDB" : "Steam"} 刷新资料
          </Button>
        )}
        {canManage && game.source === "MANUAL" && (
          <Button type="button" variant="secondary" onClick={() => setEditing((e) => !e)}>
            {editing ? "取消编辑" : "编辑"}
          </Button>
        )}
        {canManage && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (!confirm(`把《${game.name}》移出游戏库？`)) return;
              run(() => removeFromLibraryAction(groupId, game.id));
            }}
          >
            移出游戏库
          </Button>
        )}
      </div>
      {editing && (
        <ManualGameForm groupId={groupId} game={game} onSaved={() => setEditing(false)} />
      )}
    </div>
  );
}

export function AddedBy({ entry }: { entry: LibraryEntry }) {
  return (
    <p className="flex items-center gap-2 text-sm text-zinc-500">
      {entry.addedBy && (
        <Avatar src={entry.addedBy.avatarUrl} name={entry.addedBy.displayName} size={20} />
      )}
      {entry.addedBy?.displayName ?? "已注销用户"} 于 <LocalDate value={entry.addedAt} /> 添加
    </p>
  );
}
