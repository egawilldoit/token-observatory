export type PlanRealityPoint = {
  date: string;
  timestampMs: number;
  ceiling: number;
  /** Real provider observation for this checkpoint date, if any. */
  providerObservation: number | null;
};

const W = 640;
const H = 120;
const PAD_L = 40;
const PAD_R = 10;
const PAD_T = 10;
const PAD_B = 20;

function xFor(i: number, n: number): number {
  if (n <= 1) return PAD_L;
  return PAD_L + (i / (n - 1)) * (W - PAD_L - PAD_R);
}

function yFor(v: number, max: number): number {
  const t = Math.max(0, Math.min(1, v / max));
  return PAD_T + (1 - t) * (H - PAD_T - PAD_B);
}

function linePath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

/**
 * Plan vs reality (V2, compact).
 * - Safe Plan line: full contract ceilings.
 * - Provider Actual: dots only where real observations exist (never invented).
 * - Today marker, sparse date labels, % axis, keyboard-accessible dots.
 */
export function PaceChart({
  points,
  nowMs,
}: {
  points: PlanRealityPoint[];
  nowMs: number;
}) {
  if (points.length === 0) return null;
  const maxCeiling = Math.max(...points.map((p) => p.ceiling), 0.01);
  const maxObserved = Math.max(0, ...points.map((p) => p.providerObservation ?? 0));
  const max = Math.max(0.25, maxCeiling * 1.05, maxObserved * 1.05, 1.0 * 0.3);

  const ceilingPts = points.map((p, i) => ({ x: xFor(i, points.length), y: yFor(p.ceiling, max) }));

  // Today marker: first index whose checkpoint is after now, minus interpolation.
  let todayIndex = points.findIndex((p) => p.timestampMs > nowMs);
  if (todayIndex < 0) todayIndex = points.length - 1;
  const todayX = xFor(Math.max(0, todayIndex), points.length);

  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="mt-3 h-auto w-full"
      role="img"
      aria-label="Monthly safe plan versus real provider usage. Dots mark real observations only."
    >
      <title>Plan versus reality</title>
      <desc>
        Blue line is the safe plan ceiling. Green dots are real OpenCode usage observations. No
        history is invented where no observation exists.
      </desc>
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={yFor(t * max, max)}
            y2={yFor(t * max, max)}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
          <text x={2} y={yFor(t * max, max) + 3} fontSize={9} fill="#64748b">
            {Math.round(t * max * 100)}%
          </text>
        </g>
      ))}
      {points.map((p, i) =>
        i % labelEvery === 0 || i === points.length - 1 ? (
          <text key={p.date} x={xFor(i, points.length)} y={H - 6} fontSize={8} fill="#94a3b8" textAnchor="middle">
            {p.date.slice(5)}
          </text>
        ) : null,
      )}
      <line x1={todayX} x2={todayX} y1={PAD_T} y2={H - PAD_B} stroke="#0ea5e9" strokeWidth={1} strokeDasharray="3 3" />
      <text x={todayX + 3} y={PAD_T + 8} fontSize={8} fill="#0284c7">
        today
      </text>
      <path d={linePath(ceilingPts)} fill="none" stroke="#93c5fd" strokeWidth={2} />
      {points.map((p, i) =>
        p.providerObservation == null ? null : (
          <g key={p.date} tabIndex={0} role="img" aria-label={`${p.date}: provider ${Math.round(p.providerObservation * 100)}%, safe ${(p.ceiling * 100).toFixed(2)}%`}>
            <title>{`${p.date} · provider ${Math.round(p.providerObservation * 100)}% · safe ${(p.ceiling * 100).toFixed(2)}%`}</title>
            <circle cx={xFor(i, points.length)} cy={yFor(p.providerObservation, max)} r={3.5} fill="#059669" stroke="#fff" strokeWidth={1} />
          </g>
        ),
      )}
    </svg>
  );
}
