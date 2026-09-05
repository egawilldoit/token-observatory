export type PacePoint = {
  date: string;
  ceiling: number;
  actual: number | null;
};

const W = 640;
const H = 220;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 24;

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
 * Decorative planned-vs-actual chart. The checkpoint table exposes the
 * equivalent data accessibly, so this SVG is intentionally aria-hidden.
 */
export function PaceChart({ checkpoints }: { checkpoints: PacePoint[] }) {
  if (checkpoints.length === 0) return null;
  const maxActual = Math.max(0, ...checkpoints.map((c) => c.actual ?? 0));
  const max = Math.max(1.0, maxActual * 1.05);
  const ceilingPts = checkpoints.map((c, i) => ({ x: xFor(i, checkpoints.length), y: yFor(c.ceiling, max) }));

  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  checkpoints.forEach((c, i) => {
    if (c.actual == null) {
      if (current.length > 0) segments.push(current);
      current = [];
    } else {
      current.push({ x: xFor(i, checkpoints.length), y: yFor(c.actual, max) });
    }
  });
  if (current.length > 0) segments.push(current);

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${W} ${H}`}
      className="mt-3 h-auto w-full"
      role="presentation"
    >
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={yFor(t * max, max)}
            y2={yFor(t * max, max)}
            stroke="#e2e8f0"
            strokeWidth={1}
          />
          <text x={4} y={yFor(t * max, max) + 3} fontSize={9} fill="#64748b">
            {Math.round(t * max * 100)}%
          </text>
        </g>
      ))}
      <path d={linePath(ceilingPts)} fill="none" stroke="#93c5fd" strokeWidth={2} />
      {segments.map((seg, i) =>
        seg.length === 1 ? (
          <circle key={i} cx={seg[0]?.x} cy={seg[0]?.y} r={3} fill="#059669" />
        ) : (
          <path key={i} d={linePath(seg)} fill="none" stroke="#059669" strokeWidth={2} />
        ),
      )}
    </svg>
  );
}
