import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AddedBy,
  GameCover,
  GameDetailActions,
  HotnessBreakdown,
  PriceTag,
  ReviewSummary,
} from "@/components/games";
import { PlayTotals, TogetherList } from "@/components/play";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { canManageGroupGame } from "@/lib/games/rules";
import { getLibraryEntry } from "@/lib/games/service";
import { getGroupForMember } from "@/lib/groups/service";
import { gamePlayTotals, groupTogether, libraryHotness } from "@/lib/play/service";

export const metadata = { title: "游戏详情 · Game Vote" };

function Facts({ items }: { items: [string, React.ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-zinc-500">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function GameDetailPage({
  params,
}: {
  params: Promise<{ id: string; gameId: string }>;
}) {
  const { id, gameId } = await params;
  const user = await requireUser();
  const [group, entry] = await Promise.all([
    getGroupForMember(id, user.id),
    getLibraryEntry(id, gameId),
  ]);
  if (!group || !entry) notFound();
  const [together, totals, hot] = await Promise.all([
    groupTogether(id, { gameId, days: 90 }),
    gamePlayTotals(id, gameId),
    libraryHotness(id, [entry]),
  ]);
  const g = entry.game;
  const join = (xs: string[]) => (xs.length ? xs.join(" · ") : null);

  return (
    <div className="space-y-6">
      <Link href={`/groups/${id}/games`} className="text-sm text-zinc-500 hover:underline">
        ← 游戏库
      </Link>
      <Card className="space-y-5 overflow-hidden p-0">
        <GameCover src={g.coverUrl} name={g.name} className="aspect-[460/215] w-full" />
        <div className="space-y-4 px-6 pb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold">{g.name}</h2>
              <AddedBy entry={entry} />
            </div>
            <PriceTag game={g} />
          </div>
          <ReviewSummary game={g} />
          {g.description && (
            <p className="whitespace-pre-line text-zinc-700 dark:text-zinc-300">{g.description}</p>
          )}
          <Facts
            items={[
              ["类型", join(g.genres)],
              ["游玩方式", join(g.features)],
              ["平台", join(g.platforms)],
              ["开发商", join(g.developers)],
              ["发行日期", g.releaseDate],
              ["Metacritic", g.reviewPercent !== null ? g.metacritic : null],
              [
                g.source === "STEAM" ? "Steam 商店" : g.source === "IGDB" ? "官网 / IGDB" : "链接",
                g.storeUrl && (
                  <a
                    href={g.storeUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="break-all text-indigo-600 hover:underline"
                  >
                    {g.source === "STEAM" ? "在 Steam 上查看" : g.storeUrl}
                  </a>
                ),
              ],
            ]}
          />
          {g.screenshots.length > 0 && (
            <ul aria-label="截图" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {g.screenshots.map((src) => (
                <li key={src}>
                  <GameCover src={src} name={g.name} className="aspect-video w-full rounded-lg" />
                </li>
              ))}
            </ul>
          )}
          <GameDetailActions
            groupId={id}
            game={g}
            canManage={canManageGroupGame(user.id, entry, group.ownerId)}
          />
        </div>
      </Card>
      <Card className="space-y-3">
        <h3 className="font-semibold">热度</h3>
        <HotnessBreakdown hot={hot[gameId]} />
      </Card>
      <Card className="space-y-3">
        <h3 className="font-semibold">一起玩的记录（近 90 天）</h3>
        <TogetherList
          groupId={id}
          items={together}
          showGame={false}
          empty="还没有检测到群成员一起玩这个游戏。"
        />
      </Card>
      <Card className="space-y-3">
        <h3 className="font-semibold">成员游玩时长（近 30 天）</h3>
        <PlayTotals totals={totals} />
      </Card>
    </div>
  );
}
