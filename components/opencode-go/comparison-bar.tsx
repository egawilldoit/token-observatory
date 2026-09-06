import type { OpenCodeGoV2Status } from "@/lib/opencode-go/comparison";
import { formatPoints, formatWholePercent } from "@/lib/opencode-go/format";

function actualTone(status: OpenCodeGoV2Status): string {
  switch (status) {
    case "ON_TRACK":
      return "bg-emerald-500";
    case "NEAR_PLAN":
      return "bg-amber-500";
    case "OVER_PACE":
    case "LIMIT_EXCEEDED":
      return "bg-red-500";
    default:
      return "bg-slate-400";
  }
}

/**
 * Ledger 0–100 comparison bar. Pure presentation of server-computed values:
 * provider actual, active safe ceiling, provider remaining, safe headroom.
 * Remaining (to 100%) and headroom (to the safe ceiling) are separate
 * segments with separate labels and never merge visually.
 */
export function ComparisonBar({
  actual,
  safe,
  remaining,
  headroom,
  status,
}: {
  actual: number | null;
  safe: number;
  remaining: number | null;
  headroom: number | null;
  status: OpenCodeGoV2Status;
}) {
  const safePct = Math.max(0, Math.min(100, safe * 100));
  const actualPct = actual == null ? null : Math.max(0, Math.min(100, actual * 100));
  const over = actual != null && actual > safe;
  const headroomLabel = headroom == null ? "—" : formatPoints(headroom);
  const summary =
    actual == null
      ? `Safe ceiling ${Math.round(safePct)} percent. Waiting for the first provider reading.`
      : `Actual ${Math.round(actualPct as number)} percent, safe ceiling ${Math.round(safePct)} percent, headroom ${headroomLabel}.`;

  return (
    <figure aria-label={`Usage comparison. ${summary}`} role="img" className="mt-3">
      <div className="relative h-2.5 rounded-full bg-slate-100" aria-hidden="true">
        {actualPct != null ? (
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${actualTone(status)} opacity-90`}
            style={{ width: `${Math.min(actualPct, safePct)}%` }}
          />
        ) : null}
        {actualPct != null && !over ? (
          <div
            className="absolute inset-y-0 rounded-full bg-blue-300"
            style={{ left: `${actualPct}%`, width: `${Math.max(0, safePct - actualPct)}%` }}
          />
        ) : null}
        {actualPct != null && over ? (
          <div
            className="absolute inset-y-0 rounded-full bg-red-300"
            style={{ left: `${safePct}%`, width: `${Math.max(0, actualPct - safePct)}%` }}
          />
        ) : null}
        <div
          className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded bg-blue-800"
          style={{ left: `calc(${safePct}% - 1px)` }}
          title={`Safe ${Math.round(safePct)}%`}
        />
        {actualPct != null ? (
          <div
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow-sm"
            style={{ left: `${actualPct}%` }}
            title={`Actual ${Math.round(actualPct)}%`}
          />
        ) : null}
      </div>
      <div className="mt-1.5 flex items-baseline justify-between text-[11px] tabular-nums" aria-hidden="true">
        <span className="text-slate-400">0%</span>
        <span className="text-slate-400">100%</span>
      </div>
      <figcaption className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5 text-slate-600">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-slate-900" />
          Actual {actual == null ? "—" : formatWholePercent(actual)}
        </span>
        <span className="inline-flex items-center gap-1.5 text-slate-600">
          <span aria-hidden="true" className="h-2.5 w-0.5 rounded bg-blue-800" />
          Safe {(safe * 100).toFixed(2)}%
        </span>
        <span className="ml-auto inline-flex items-center gap-3 text-slate-600">
          <span>
            Provider remaining ·{" "}
            <strong className="font-semibold text-slate-900">
              {remaining == null ? "—" : formatWholePercent(remaining)}
            </strong>
          </span>
          <span>
            Safe headroom ·{" "}
            <strong className="font-semibold text-slate-900">{headroomLabel}</strong>
          </span>
        </span>
      </figcaption>
    </figure>
  );
}
