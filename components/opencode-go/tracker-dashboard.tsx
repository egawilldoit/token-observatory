import type { ReactNode } from "react";

import { formatPercent, formatPoints, type TrackerViewModel } from "@/lib/opencode-go/view-model";
import { TrackerStatus } from "./tracker-status";

function formatCasablanca(instantIso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Casablanca",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(instantIso));
}

function countdown(nowIso: string, resetIso: string): string {
  const ms = Date.parse(resetIso) - Date.parse(nowIso);
  if (ms <= 0) return "due now";
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h left`;
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m left`;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.025)]">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function TrackerDashboard({
  view,
  history,
  children,
}: {
  view: TrackerViewModel | null;
  history?: ReactNode;
  children?: ReactNode;
}) {
  if (!view) {
    return (
      <>
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
            OpenCode Go
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950 md:text-[2rem]">
            Monthly usage pacing
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            No OpenCode Go tracker imported yet. Upload your monthly tracker to
            start pacing.
          </p>
        </header>
        {children}
        {history}
      </>
    );
  }

  const stale = view.status === "UPDATE_DUE";
  const fresh = !stale && !view.preFirstCheckpoint && view.status !== "RESET_REQUIRED" && view.status !== "LIMIT_EXCEEDED";
  const usageLabel = stale ? "Last recorded usage" : "Recorded usage";
  const usageHint =
    view.latestRecorded.source === "baseline"
      ? "Cycle baseline"
      : view.latestRecorded.checkpointDate
        ? `${view.latestRecorded.checkpointDate} checkpoint`
        : undefined;
  const ceilingLabel = stale ? "Today's planned ceiling" : view.preFirstCheckpoint ? "Next planned ceiling" : "Planned ceiling";
  const ceilingValue = view.requiredCeiling ?? view.checkpoints[0]?.ceiling ?? view.cycle.plannedCeiling;
  const headroomText =
    view.headroom == null
      ? "—"
      : view.headroom >= 0
        ? `${formatPoints(view.headroom)} headroom`
        : `${formatPoints(view.headroom)} over pace`;
  const paceMax = Math.max(view.cycle.plannedCeiling, view.latestRecorded.value, 0.0001);
  const actualPct = Math.min(100, (view.latestRecorded.value / paceMax) * 100);
  const targetPct = Math.min(100, ((view.requiredCeiling ?? view.cycle.plannedCeiling) / paceMax) * 100);

  return (
    <>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
          OpenCode Go
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950 md:text-[2rem]">
          Monthly usage pacing
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          Recorded workbook observations against the planned pace. Application
          calculations are authoritative; workbook formulas are diagnostic only.
        </p>
      </header>

      {view.formulaMismatchCount > 0 ? (
        <p role="note" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Workbook formulas differ from Token Observatory calculations
          {` in ${view.formulaMismatchCount} ${view.formulaMismatchCount === 1 ? "cell" : "cells"}`}.
          Token Observatory calculations are being used.
        </p>
      ) : null}

      <div className="mt-5">
        <TrackerStatus
          status={view.status}
          preFirstCheckpoint={view.preFirstCheckpoint}
          requiredDate={view.requiredDate}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={usageLabel} value={formatPercent(view.latestRecorded.value)} hint={usageHint} />
        <Metric
          label={ceilingLabel}
          value={formatPercent(ceilingValue)}
          hint={view.requiredDate ? `${view.requiredDate} checkpoint` : undefined}
        />
        <Metric
          label={fresh || view.status === "NEAR_LIMIT" || view.status === "OVER_PACE" ? "Headroom" : "Headroom"}
          value={view.headroom == null ? "—" : formatPoints(view.headroom)}
          hint={view.headroom == null ? (stale ? "No verified Sep reading" : view.preFirstCheckpoint ? "No checkpoint due yet" : undefined) : headroomText}
        />
        <Metric
          label="Budget remaining"
          value={formatPercent(view.remainingBudget)}
          hint={stale ? "Relative to last recorded observation" : "Of planned ceiling"}
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Metric
          label="Reset"
          value={formatCasablanca(view.cycle.resetAtIso)}
          hint={countdown(view.nowIso, view.cycle.resetAtIso)}
        />
        <Metric
          label="Freshness"
          value={stale ? "Stale — update due" : view.preFirstCheckpoint ? "Not due yet" : view.status === "RESET_REQUIRED" ? "Cycle ended" : "Fresh"}
          hint={view.status === "LIMIT_EXCEEDED" ? "Hard limit reached" : undefined}
        />
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.025)]">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
          {stale ? "Last recorded vs planned pace" : "Recorded vs planned pace"}
        </p>
        <div
          aria-hidden="true"
          className="relative mt-3 h-3 overflow-hidden rounded-full bg-slate-100"
        >
          <div className="absolute inset-y-0 left-0 rounded-full bg-blue-200" style={{ width: `${targetPct}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-blue-600" style={{ width: `${actualPct}%` }} />
        </div>
        <span className="sr-only">
          {stale ? "Last recorded usage " : "Recorded usage "}
          {formatPercent(view.latestRecorded.value)} against a planned ceiling of{" "}
          {formatPercent(view.requiredCeiling ?? view.cycle.plannedCeiling)}.
        </span>
      </div>

      {children}
      {history}
    </>
  );
}
