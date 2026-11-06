import type { ReactNode } from "react";
import { msg } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";

// Signed-out home page: the pitch on one half, sign-in on the other.

const SAMPLE = [
  { name: msg("博德之门3"), votes: 4, color: "from-amber-300 to-orange-400" },
  { name: msg("双人成行"), votes: 2, color: "from-sky-300 to-indigo-400" },
  { name: "Apex Legends", votes: 1, color: "from-rose-300 to-fuchsia-400" },
];
const MAX = SAMPLE[0].votes;

const FEATURES = [
  { icon: "🗳️", title: msg("实时投票"), text: msg("票数实时刷新，每一轮都能回放") },
  { icon: "📚", title: msg("群游戏库"), text: msg("Steam、IGDB 一键添加，热度排序") },
  { icon: "🎮", title: msg("游玩检测"), text: msg("大家一起开玩了，自动提醒收尾投票") },
  { icon: "🔔", title: msg("及时通知"), text: msg("邮件和 Discord 私信，不错过新投票") },
];

/** An illustrative vote in progress (not real data). */
async function SampleRound() {
  const t = await getT();
  return (
    <figure
      aria-label={t("投票示例")}
      className="w-full max-w-sm rounded-2xl border border-white/15 bg-white/10 p-5 shadow-2xl shadow-indigo-950/50 backdrop-blur-md"
    >
      <div className="mb-4 flex items-center justify-between text-xs text-indigo-100/80">
        <span className="font-medium text-white">{t("第 {n} 轮投票", { n: 3 })}</span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
          {t("进行中")}
        </span>
      </div>
      <ol className="space-y-3">
        {SAMPLE.map((g, i) => (
          <li key={g.name}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-white">
                <span className="mr-2 text-indigo-200/70 tabular-nums">{i + 1}</span>
                {t(g.name)}
              </span>
              <span className="text-xs text-indigo-100/80 tabular-nums">
                {t("{n} 票", { n: g.votes })}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${g.color}`}
                style={{ width: `${(g.votes / MAX) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
      <figcaption className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs text-indigo-100/80">
        <span className="flex -space-x-1.5">
          {["小", "阿", "K", "M", "Z"].map((c, i) => (
            <span
              key={c}
              className="flex size-6 items-center justify-center rounded-full bg-indigo-400/80 text-[10px] font-semibold text-white ring-2 ring-indigo-900"
              style={{ filter: `hue-rotate(${i * 40}deg)` }}
            >
              {c}
            </span>
          ))}
        </span>
        {t("{voted} / {total} 人已投", { voted: 5, total: 6 })}
      </figcaption>
    </figure>
  );
}

export async function Landing({ children }: { children: ReactNode }) {
  const t = await getT();
  return (
    <main className="grid min-h-[calc(100dvh-3.5rem)] lg:grid-cols-2">
      <section className="relative overflow-hidden bg-gradient-to-br from-indigo-950 via-violet-900 to-zinc-950 px-6 py-10 text-white sm:px-10 sm:py-12 lg:px-14 lg:py-16">
        {/* Soft glows behind the content. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -left-20 size-80 rounded-full bg-fuchsia-500/25 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 bottom-0 size-96 rounded-full bg-indigo-500/25 blur-3xl"
        />
        <div className="relative mx-auto flex h-full max-w-xl flex-col justify-center gap-8 lg:gap-10">
          <div className="space-y-5">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-indigo-100">
              {t("和朋友一起 · 投票选游戏")}
            </p>
            <h1 className="text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
              {t("今晚玩什么？")}
              <br />
              <span className="bg-gradient-to-r from-amber-200 via-pink-200 to-indigo-200 bg-clip-text text-transparent">
                {t("投个票就知道。")}
              </span>
            </h1>
            <p className="max-w-md text-base leading-relaxed text-indigo-100/85">
              {t(
                "建一个群，把大家想玩的游戏放进游戏库，发起投票几分钟就定下来。聊天、游戏库、投票和历史都在一个地方。",
              )}
            </p>
          </div>

          <div className="hidden sm:block">
            <SampleRound />
          </div>

          {/* Phones skip the feature list so sign-in is on the first screen. */}
          <ul className="hidden gap-4 sm:grid sm:grid-cols-2">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-3">
                <span aria-hidden className="text-xl leading-6">
                  {f.icon}
                </span>
                <div>
                  <p className="text-sm font-semibold">{t(f.title)}</p>
                  <p className="text-xs leading-relaxed text-indigo-100/70">{t(f.text)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="flex items-center justify-center bg-white px-6 py-10 sm:px-10 sm:py-12 dark:bg-zinc-900">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </main>
  );
}
