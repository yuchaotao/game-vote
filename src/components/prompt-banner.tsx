"use client";

import { useState, useTransition } from "react";
import type { FormState } from "@/lib/auth/actions";
import { resolvePromptAction } from "@/lib/votes/actions";
import type { PromptChoice } from "@/lib/votes/prompts";
import { GameCover } from "./games";
import { Alert, Button } from "./ui";
import { Trans, useT } from "./i18n";

/** "You're playing a front-runner together: end the vote?" Shown on every group page. */
export function PromptBanner({
  groupId,
  promptId,
  game,
  roundLabel,
  players,
  memberCount,
  rank,
}: {
  groupId: string;
  promptId: string;
  game: { name: string; coverUrl: string | null };
  roundLabel: string;
  players: number;
  memberCount: number;
  /** Null in an anonymous round (the rank is secret). */
  rank: number | null;
}) {
  const t = useT();
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const choose = (choice: PromptChoice) =>
    start(async () => setState(await resolvePromptAction(groupId, promptId, choice)));

  return (
    <section
      role="region"
      aria-label={t("新投票提示")}
      className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/50"
    >
      <div className="flex items-center gap-3">
        <GameCover
          src={game.coverUrl}
          name={game.name}
          className="h-12 w-[103px] shrink-0 rounded text-base"
        />
        <p className="text-sm">
          <Trans
            text="🎮 {players}/{total} 名成员正在一起玩《{game}》，"
            values={{ players, total: memberCount, game: <strong>{game.name}</strong> }}
          />{" "}
          {rank === null
            ? t("它是{round}的候选。", { round: roundLabel })
            : t("它在{round}中排第 {rank}。", { round: roundLabel, rank })}{" "}
          {t("要结束这轮投票吗？")}
        </p>
      </div>
      {state?.error && <Alert kind="error">{state.error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={pending} onClick={() => choose("next")}>
          {t("结束投票并开启下一轮")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => choose("continue")}
        >
          {t("继续当前投票")}
        </Button>
        <button
          type="button"
          disabled={pending}
          onClick={() => choose("end")}
          className="ml-auto text-xs text-zinc-400 underline-offset-2 hover:text-zinc-600 hover:underline"
        >
          {t("仅结束当前投票")}
        </button>
      </div>
    </section>
  );
}
