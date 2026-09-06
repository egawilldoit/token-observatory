"use client";

import { useEffect, useState } from "react";

import { formatCheckpointDate, formatPoints, formatWholePercent } from "@/lib/opencode-go/format";

export type PlanRealityPoint = {
  date: string;
  timestampMs: number;
  ceiling: number;
  /** Real provider observation for this checkpoint window, if any. */
  providerObservation: number | null;
  /** Display-only row status/headroom for tooltips (server-computed). */
  status?: string | null;
  headroom?: number | null;
};

const DESKTOP = { W: 720, H: 300, PAD_L: 46, PAD_R: 14, PAD_T: 16, PAD_B: 26 };
/** Taller aspect so the chart stays useful on narrow screens (~225px tall). */
const MOBILE = { W: 420, H: 290, PAD_L: 42, PAD_R: 12, PAD_T: 18, PAD_B: 30 };
const TICKS = [0, 0.25, 0.5, 0.75, 1];

/** SSR-safe viewport flag: desktop first, then follows the viewport. */
function useCompactChart(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return compact;
}

function dotColor(status: string | null | undefined): string {
  switch (status) {
    case "On track":
      return "#059669";
    case "Near plan":
      return "#d97706";
    case "Over pace":
    case "Limit exceeded":
      return "#dc2626";
    default:
      return "#64748b";
  }
}

function shortDate(date: string): string {
  return formatCheckpointDate(date);
}

/**
 * Plan vs reality (Ledger).
 * - Fixed 0/25/50/75/100 Y-axis; useful date labels on X (fewer on mobile).
 * - Continuous Safe Plan line (contract history genuinely exists) with a
 *   restrained safe zone beneath it.
 * - Provider observations are real captures only: one point stays one point,
 *   two points stay two points, three or more connect honestly.
 * - Today, ACTIVE, and next-checkpoint markers. ACTIVE sits left of its line
 *   and Today above/right of the dashed line so they never compete.
 * - Keyboard-focusable points with full tooltips (date, provider, safe,
 *   headroom, status).
 */
export function PaceChart({
  points,
  nowMs,
}: {
  points: PlanRealityPoint[];
  nowMs: number;
}) {
  const compact = useCompactChart();
  const { W, H, PAD_L, PAD_R, PAD_T, PAD_B } = compact ? MOBILE : DESKTOP;

  function xFor(i: number, n: number): number {
    if (n <= 1) return PAD_L;
    return PAD_L + (i / (n - 1)) * (W - PAD_L - PAD_R);
  }

  function yFor(v: number): number {
    const t = Math.max(0, Math.min(1, v));
    return PAD_T + (1 - t) * (H - PAD_T - PAD_B);
  }

  function linePath(pts: { x: number; y: number }[]): string {
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  }

  if (points.length === 0) return null;

  const ceilingPts = points.map((p, i) => ({ x: xFor(i, points.length), y: yFor(p.ceiling) }));
  const zonePath = `${linePath(ceilingPts)} L${ceilingPts[ceilingPts.length - 1]!.x.toFixed(1)},${yFor(0).toFixed(1)} L${ceilingPts[0]!.x.toFixed(1)},${yFor(0).toFixed(1)} Z`;

  const observed = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.providerObservation != null);

  let todayIndex = points.findIndex((p) => p.timestampMs > nowMs);
  if (todayIndex < 0) todayIndex = points.length - 1;
  const todayX = xFor(Math.max(0, todayIndex), points.length);

  const activeIndex = points.findIndex(
    (p) => p.timestampMs <= nowMs && (points[points.indexOf(p) + 1]?.timestampMs ?? Infinity) > nowMs,
  );
  const nextIndex = activeIndex >= 0 && activeIndex + 1 < points.length ? activeIndex + 1 : -1;

  const activeX = activeIndex >= 0 ? xFor(activeIndex, points.length) : null;
  const nextX = nextIndex >= 0 ? xFor(nextIndex, points.length) : null;
  // A next marker on top of the today marker adds noise, not information.
  const showNext = nextIndex >= 0 && nextX != null && Math.abs(nextX - todayX) >= 10;

  const labelEvery = Math.max(1, Math.ceil(points.length / (compact ? 3 : 7)));
  const dateFor = (i: number) => shortDate(points[i]!.date);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-3 h-auto w-full"
      role="group"
      aria-label="Monthly safe plan versus real provider usage. The blue line is the safe ceiling with the safe zone beneath it. Dots mark real provider observations only."
    >
      <title>Plan versus reality</title>
      <desc>
        Safe plan ceiling as a continuous blue line with a shaded safe zone beneath. Real
        OpenCode usage appears as dots only where observations were captured. Dashed marker
        for today, ACTIVE marker for the current checkpoint, Next marker for the coming
        checkpoint.
      </desc>
      {TICKS.map((t) => (
        <g key={t}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={yFor(t)}
            y2={yFor(t)}
            stroke={t === 0 ? "#cbd5e1" : "#e8edf3"}
            strokeWidth={1}
          />
          <text x={PAD_L - 8} y={yFor(t) + 3.5} fontSize={10} fill="#64748b" textAnchor="end" className="tabular-nums">
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}
      {points.map((p, i) =>
        i % labelEvery === 0 || i === points.length - 1 ? (
          <text
            key={p.date}
            x={i === points.length - 1 ? xFor(i, points.length) - 2 : xFor(i, points.length)}
            y={H - 8}
            fontSize={10}
            fill="#94a3b8"
            textAnchor={i === points.length - 1 ? "end" : "middle"}
          >
            {dateFor(i)}
          </text>
        ) : null,
      )}
      <path d={zonePath} fill="#dbeafe" opacity={0.45} />
      <path d={linePath(ceilingPts)} fill="none" stroke="#3b82f6" strokeWidth={2} />
      {observed.length >= 3 ? (
        <path
          d={linePath(observed.map(({ p, i }) => ({ x: xFor(i, points.length), y: yFor(p.providerObservation as number) })))}
          fill="none"
          stroke="#059669"
          strokeWidth={1.5}
          opacity={0.85}
        />
      ) : null}
      {showNext ? (
        <g>
          <line x1={nextX as number} x2={nextX as number} y1={PAD_T} y2={H - PAD_B} stroke="#94a3b8" strokeWidth={1} strokeDasharray="2 3" />
          <text x={(nextX as number) + 4} y={PAD_T + 10} fontSize={9} fill="#64748b">
            Next
          </text>
        </g>
      ) : null}
      {activeX != null ? (
        <g>
          <line x1={activeX} x2={activeX} y1={PAD_T} y2={H - PAD_B} stroke="#1d4ed8" strokeWidth={1.5} />
          <text x={activeX - 6} y={PAD_T + (compact ? 56 : 38)} fontSize={9} fontWeight={700} fill="#1d4ed8" textAnchor="end">
            ACTIVE
          </text>
        </g>
      ) : null}
      <line x1={todayX} x2={todayX} y1={PAD_T} y2={H - PAD_B} stroke="#0ea5e9" strokeWidth={1} strokeDasharray="4 3" />
      <text x={todayX + 4} y={PAD_T + 10} fontSize={9} fill="#0284c7">
        Today
      </text>
      {observed.map(({ p, i }) => {
        const headroom = p.headroom == null ? "—" : formatPoints(p.headroom);
        const actual = formatWholePercent(p.providerObservation as number);
        const safe = `${(p.ceiling * 100).toFixed(2)}%`;
        const label = `${shortDate(p.date)} checkpoint · Provider usage ${actual} · Safe ceiling ${safe} · Headroom ${headroom} · Status ${p.status ?? "—"}`;
        return (
          <g
            key={p.date}
            tabIndex={0}
            role="img"
            aria-label={label}
            className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <title>{label}</title>
            <circle
              cx={xFor(i, points.length)}
              cy={yFor(p.providerObservation as number)}
              r={4}
              fill={dotColor(p.status)}
              stroke="#fff"
              strokeWidth={1.5}
            />
          </g>
        );
      })}
    </svg>
  );
}
