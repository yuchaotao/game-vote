"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import type { FormState } from "@/lib/auth/actions";
import { peekAction } from "@/lib/votes/actions";
import { Alert, Button } from "./ui";

/** Shows an anonymous round's results to this member; everyone sees who peeked. */
export function PeekButton({ groupId, roundId }: { groupId: string; roundId: string }) {
  const [state, setState] = useState<FormState>();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {state?.error && <Alert kind="error">{state.error}</Alert>}
      <Button
        type="button"
        variant="secondary"
        className="px-3 py-1.5"
        disabled={pending}
        onClick={() => {
          if (!confirm("偷看后，群里所有人都会看到你偷看了结果。确定要看吗？")) return;
          start(async () => setState(await peekAction(groupId, roundId)));
        }}
      >
        👀 偷看结果
      </Button>
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
