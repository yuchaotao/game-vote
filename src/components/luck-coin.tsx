import { COIN_LABEL, coinTier, type CoinTier } from "@/lib/votes/gamble-rules";

// A member's lucky coin (#57): the metal improves as their luck climbs.

const METAL: Record<CoinTier, { stops: [string, string, string]; rim: string; mark: string }> = {
  rusty: { stops: ["#c08a5b", "#8a5a36", "#5e3b22"], rim: "#4a2e1a", mark: "#3b2414" },
  copper: { stops: ["#f3b07c", "#c8763f", "#8f4f26"], rim: "#7a3f1d", mark: "#6b3518" },
  silver: { stops: ["#ffffff", "#c9ced6", "#8d96a3"], rim: "#6b7280", mark: "#4b5563" },
  gold: { stops: ["#fff3b0", "#f5c542", "#b8860b"], rim: "#9a6b00", mark: "#7c5300" },
  shining: { stops: ["#fffbe0", "#ffd84d", "#d39b00"], rim: "#a86f00", mark: "#7c5300" },
  rainbow: { stops: ["#ff8ad8", "#8ec5ff", "#8affc1"], rim: "#7c3aed", mark: "#ffffff" },
};

export function LuckCoin({
  luck,
  size = 18,
  showValue = false,
}: {
  luck: number;
  size?: number;
  /** Also print the percentage next to the coin. */
  showValue?: boolean;
}) {
  const tier = coinTier(luck);
  const m = METAL[tier];
  const id = `coin-${tier}`;
  const label = `幸运硬币：${COIN_LABEL[tier]} ${luck}%`;
  return (
    <span className="inline-flex items-center gap-1 align-middle" title={label}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        role="img"
        aria-label={label}
        className={tier === "rainbow" ? "luck-coin-spin" : undefined}
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={m.stops[0]} />
            <stop offset="0.5" stopColor={m.stops[1]} />
            <stop offset="1" stopColor={m.stops[2]} />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="10.5" fill={`url(#${id})`} stroke={m.rim} strokeWidth="1.5" />
        <circle cx="12" cy="12" r="7.2" fill="none" stroke={m.rim} strokeOpacity="0.45" />
        {/* A four-leaf clover on the face. */}
        <g fill={m.mark} fillOpacity={tier === "rusty" ? 0.55 : 0.85}>
          <circle cx="10.2" cy="10.2" r="2.1" />
          <circle cx="13.8" cy="10.2" r="2.1" />
          <circle cx="10.2" cy="13.8" r="2.1" />
          <circle cx="13.8" cy="13.8" r="2.1" />
        </g>
        {tier === "rusty" && (
          <g fill="#2f1b0e" fillOpacity="0.5">
            <circle cx="7" cy="15.5" r="1.1" />
            <circle cx="16.8" cy="7.5" r="0.9" />
          </g>
        )}
        {(tier === "shining" || tier === "rainbow") && (
          <path
            className="luck-coin-sparkle"
            d="M19.5 1.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"
            fill="#fff7c2"
            stroke="#e0a800"
            strokeWidth="0.4"
          />
        )}
      </svg>
      {showValue && <span className="text-xs text-zinc-500 tabular-nums">{luck}%</span>}
    </span>
  );
}
