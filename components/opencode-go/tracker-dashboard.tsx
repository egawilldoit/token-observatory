import type { ReactNode } from "react";

import type { V2Comparison, V2ContractMeta } from "@/lib/opencode-go/v2-view";
import {
  countdownTo,
  describeCheckpointDay,
  formatCasablancaShort,
  formatCheckpointDate,
  formatFreshnessAge,
  formatPercent,
  formatPoints,
  formatWholePercent,
} from "@/lib/opencode-go/format";
import { CheckpointTable, type V2CheckpointRow } from "./checkpoint-table";
import { ComparisonBar } from "./comparison-bar";
import { PaceChart, type PlanRealityPoint } from "./pace-chart";
import { TrackerStatus } from "./tracker-status";
import { RefreshButton } from "./refresh-button";
import { AutoRefresh } from "./auto-refresh";
import { ReplacePlan } from "./replace-plan";

export type V2DashboardData = {
  contractMeta: V2ContractMeta;
  comparison: V2Comparison;
  checkpointRows: V2CheckpointRow[];
  chartPoints: PlanRealityPoint[];
  latestObservedAtMs: number | null;
  providerHistoryCount: number;
  nowMs: number;
  roomToNext: number | null;
};

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 truncate text-2xl font-semibold tabular-nums tracking-tight text-slate-950 lg:text-[1.7rem]">
        {value}
      </p>
      <p className="mt-0.5 truncate text-xs text-slate-500">{sub}</p>
    </div>
  );
}

function supportingSentence(comparison: V2Comparison): string {
  if (comparison.status === "RESET_REQUIRED") {
    return "This contract cycle ended. Upload a new Monthly Safe Plan to resume tracking.";
  }
  if (comparison.providerMonthly == null || comparison.safeHeadroom == null) {
    return "Waiting for the first provider reading.";
  }
  const pp = formatPoints(comparison.safeHeadroom);
  return comparison.safeHeadroom < 0
    ? `${formatPoints(Math.abs(comparison.safeHeadroom))} above the active safe ceiling.`
    : `${pp} below the active safe ceiling.`;
}

export function TrackerDashboard({
  data,
  history,
  children,
}: {
  data: V2DashboardData | null;
  history?: ReactNode;
  children?: ReactNode;
}) {
  if (!data) {
    return (
      <>
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">OpenCode Go</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
            Monthly plan vs reality
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            No Monthly Safe Plan imported yet. Upload your monthly tracker to start comparing
            against real OpenCode usage.
          </p>
        </header>
        {children}
        {history}
      </>
    );
  }

  const { contractMeta, comparison, checkpointRows, chartPoints, latestObservedAtMs, nowMs, roomToNext } = data;
  const syncedAgo = formatFreshnessAge(comparison.freshnessAgeMs);
  // Raw provider readings use whole-percent precision (the API never supplies
  // decimals). Contract ceilings and derived headroom keep decimals.
  const providerPct = comparison.providerMonthly != null ? formatWholePercent(comparison.providerMonthly) : "—";
  const safePct = formatPercent(comparison.activeCeiling);
  const headroomValue = comparison.safeHeadroom == null ? "—" : formatPoints(comparison.safeHeadroom);

  const activeLabel = comparison.activeCheckpoint
    ? `${formatCheckpointDate(comparison.activeCheckpoint.date)} checkpoint · ${formatPercent(comparison.activeCeiling)}`
    : `Cycle baseline · ${formatPercent(comparison.activeCeiling)}`;
  const nextLabel = comparison.nextCheckpoint
    ? `${describeCheckpointDay(comparison.nextCheckpoint.timestampMs, nowMs)} · ${comparison.nextCheckpoint.checkTime} · ${
        comparison.nextCeiling != null ? formatPercent(comparison.nextCeiling) : "—"
      } · ${roomToNext == null ? "—" : `${formatPoints(roomToNext)} room`} · ${countdownTo(comparison.msUntilNext)}`
    : `Cycle ends at reset · ${formatCasablancaShort(contractMeta.resetAtIso)}`;

  return (
    <>
      <AutoRefresh latestObservedAtMs={latestObservedAtMs} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">OpenCode Go</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
            Monthly plan vs reality
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs tabular-nums text-slate-500" aria-live="polite">
            {comparison.freshness} · {syncedAgo}
          </p>
          <RefreshButton />
        </div>
      </header>

      <section
        aria-label="Current comparison"
        className="mt-3 rounded-xl border border-slate-200/90 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
          <Metric label="Current" value={providerPct} sub="OpenCode API" />
          <Metric label="Safe now" value={safePct} sub="Active checkpoint" />
          <Metric label="Headroom" value={headroomValue} sub="Percentage points" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status</p>
            <p className="mt-1.5">
              <TrackerStatus status={comparison.status} />
            </p>
          </div>
        </div>
        <p className="mt-2 text-[13px] text-slate-600">{supportingSentence(comparison)}</p>
        <ComparisonBar
          actual={comparison.providerMonthly}
          safe={comparison.activeCeiling}
          remaining={comparison.providerRemaining}
          headroom={comparison.safeHeadroom}
          status={comparison.status}
        />
        <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-[13px]">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-medium text-slate-500">Active ceiling</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{activeLabel}</dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="font-medium text-slate-500">Next ceiling activates</dt>
            <dd className="font-semibold tabular-nums text-slate-900">{nextLabel}</dd>
          </div>
        </dl>
      </section>

      <section
        aria-label="Plan versus reality"
        className="mt-3 rounded-xl border border-slate-200/90 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        <h2 className="text-sm font-semibold text-slate-950">Plan vs reality</h2>
        <PaceChart points={chartPoints} nowMs={nowMs} />
      </section>

      <CheckpointTable checkpoints={checkpointRows} />

      <section
        aria-label="Monthly safe plan"
        className="mt-3 rounded-xl border border-slate-200/90 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-950">Monthly Safe Plan</h2>
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
            Active
          </span>
        </div>
        <p className="mt-1 text-sm font-medium tabular-nums text-slate-900">
          {contractMeta.trackingStartIso.slice(0, 10)} → {contractMeta.resetAtIso.slice(0, 10)}
        </p>
        <p className="mt-0.5 text-xs tabular-nums text-slate-500">
          {contractMeta.checkpointCount} checkpoints · Daily at {contractMeta.checkTime} · Baseline{" "}
          {formatPercent(contractMeta.baseline)}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <details className="group">
            <summary className="cursor-pointer list-none rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 [&::-webkit-details-marker]:hidden">
              View details
            </summary>
            <dl className="mt-2 space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <div className="flex justify-between gap-3">
                <dt>File</dt>
                <dd className="font-medium text-slate-800">{contractMeta.filename ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Planned ceiling</dt>
                <dd className="tabular-nums">{formatPercent(contractMeta.plannedCeiling)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Contract reset</dt>
                <dd>{formatCasablancaShort(contractMeta.resetAtIso)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Provider reset</dt>
                <dd>
                  {comparison.providerResetsAtMs != null
                    ? formatCasablancaShort(new Date(comparison.providerResetsAtMs).toISOString())
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Provenance</dt>
                <dd>Uploaded workbook · {formatCasablancaShort(contractMeta.importedAt ?? contractMeta.trackingStartIso)}</dd>
              </div>
            </dl>
          </details>
          <ReplacePlan>{children}</ReplacePlan>
        </div>
      </section>

      {history}

      <details className="mt-3 rounded-xl border border-slate-200/90 bg-white px-4 py-3 text-xs text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-700">About data</summary>
        <p className="mt-2 leading-5">
          Your Monthly Safe Plan comes from the uploaded Excel workbook and never changes until
          you replace it. Current usage comes from the OpenCode Go API. This page compares the
          two, monthly only: safe headroom is the safe ceiling minus real usage, in percentage
          points. Provider observations are real captures only — history is never invented.
        </p>
      </details>
    </>
  );
}
