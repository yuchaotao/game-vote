"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import type { FormState } from "@/lib/auth/actions";
import { gamblePeekAction, gambleSwapAction } from "@/lib/votes/actions";
import { LuckCoin } from "./luck-coin";
import { Alert, Button } from "./ui";

/** 赌一把 and 偷梁换柱 (#57), a few times each per round, won with the member's lucky coin. */
export function GambleActions({
  groupId,
  roundId,
  luck,
  limit,
  peekLeft,
  swapLeft,
  hasVotes,
}: {
  groupId: string;
  roundId: string;
  luck: number;
  /** Attempts of each per round. */
  limit: number;
  peekLeft: number;
  swapLeft: number;
  /** 偷梁换柱 copies one of your own votes, so you need some. */
  hasVotes: boolean;
}) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  const run = (question: string, fn: () => Promise<FormState>) => {
    if (!confirm(question)) return;
    start(async () => setState(await fn()));
  };
  return (
    <div className="space-y-2">
      {state?.error && <Alert kind="error">{state.error}</Alert>}
      {state?.ok && <Alert kind="ok">{state.ok}</Alert>}
      <p className="flex flex-wrap items-center gap-1 text-xs text-zinc-500">
        你的幸运硬币 <LuckCoin luck={luck} showValue />
        ：成功率 {luck}%，成功 +5%、失败 −1%，每轮各 {limit} 次。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          className="px-3 py-1.5"
          disabled={pending || peekLeft <= 0}
          onClick={() =>
            run(
              `赌一把：有 ${luck}% 的概率偷看成功（结果只显示这一次，没人知道）；失败的话大家都会看到你想偷看。`,
              () => gamblePeekAction(groupId, roundId),
            )
          }
        >
          🎲 {peekLeft > 0 ? `赌一把 · 剩 ${peekLeft} 次` : "次数已用完"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="px-3 py-1.5"
          disabled={pending || swapLeft <= 0 || !hasVotes}
          title={hasVotes ? undefined : "先投票才能偷梁换柱"}
          onClick={() =>
            run(
              `偷梁换柱：有 ${luck}% 的概率把别人的一票悄悄换成你投的游戏；失败会公开「你尝试改谁的票」。`,
              () => gambleSwapAction(groupId, roundId),
            )
          }
        >
          😈 {swapLeft > 0 ? `偷梁换柱 · 剩 ${swapLeft} 次` : "次数已用完"}
        </Button>
      </div>
    </div>
  );
}

const COLORS = ["#f59e0b", "#ec4899", "#6366f1", "#10b981", "#facc15", "#38bdf8", "#f43f5e"];

type Piece = {
  left: number;
  size: number;
  color: string;
  dx: number;
  rot: number;
  delay: number;
  time: number;
  round: boolean;
};

/**
 * Confetti for the first look at a revealed anonymous round, timed to fall as
 * the winner appears. Pieces are made after mount (random), and it removes itself.
 */
export function RevealConfetti({ delaySeconds }: { delaySeconds: number }) {
  const [pieces, setPieces] = useState<Piece[]>([]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setPieces(
      Array.from({ length: 90 }, () => ({
        left: Math.random() * 100,
        size: 6 + Math.random() * 6,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        dx: (Math.random() - 0.5) * 40,
        rot: (Math.random() - 0.5) * 1440,
        delay: delaySeconds + Math.random() * 0.8,
        time: 2.4 + Math.random() * 2,
        round: Math.random() < 0.3,
      })),
    );
    const done = setTimeout(() => setPieces([]), (delaySeconds + 5) * 1000);
    return () => clearTimeout(done);
  }, [delaySeconds]);

  return (
    <div
      aria-hidden
      data-reveal-confetti
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
    >
      {pieces.map((p, i) => (
        <span
          key={i}
          className="confetti absolute -top-4 block"
          style={
            {
              left: `${p.left}%`,
              width: p.size,
              height: p.round ? p.size : p.size * 1.6,
              background: p.color,
              borderRadius: p.round ? "9999px" : "2px",
              "--dx": `${p.dx}vw`,
              "--rot": `${p.rot}deg`,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.time}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
