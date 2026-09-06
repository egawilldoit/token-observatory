import type { ReactNode } from "react";

import type { V2Comparison, V2ContractMeta } from "@/lib/opencode-go/v2-view";
import { formatCasablancaShort, formatFreshnessAge, formatPercent, formatPoints, formatWholePercent, countdownTo } from "@/lib/opencode-go/format";
import { CheckpointTable, type V2CheckpointRow } from "./checkpoint-table";
import { PaceChart, type PlanRealityPoint } from "./pace-chart";
import { TrackerStatus } from "./tracker-status";
import { RefreshButton } from "./refresh-button";
import { AutoRefresh } from "./auto-refresh";

function HeroMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.025)]">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

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
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950 md:text-[2rem]">
            Monthly contract vs current usage
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
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
  const headroomHint =
    comparison.safeHeadroom == null
      ? "No provider reading yet"
      : comparison.safeHeadroom < 0
        ? `${formatPoints(Math.abs(comparison.safeHeadroom))} over pace`
        : `${formatPoints(comparison.safeHeadroom)} of safe room`;
  const remainingValue =
    comparison.providerRemaining == null ? "—" : formatWholePercent(comparison.providerRemaining);

  return (
    <>
      <AutoRefresh latestObservedAtMs={latestObservedAtMs} />
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">OpenCode Go</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950 md:text-[2rem]">
          Monthly contract vs current usage
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          Your Monthly Safe Plan against real OpenCode usage. Excel is the plan, the API is
          reality — this page is the comparison.
        </p>
      </header>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500" aria-live="polite">
          {comparison.freshness} · {syncedAgo}
        </p>
        <RefreshButton />
      </div>

      <div className="mt-3">
        <TrackerStatus
          status={comparison.status}
          freshness={comparison.freshness}
          syncedAgo={syncedAgo}
          checkTime={contractMeta.checkTime}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <HeroMetric label="Current monthly" value={providerPct} hint="Real OpenCode usage" />
        <HeroMetric
          label="Safe now"
          value={safePct}
          hint={
            comparison.activeCheckpoint
              ? `${comparison.activeCheckpoint.date} safe ceiling`
              : "Cycle baseline (first checkpoint not due yet)"
          }
        />
      </div>
      <div className="mt-3 rounded-2xl border border-slate-200/90 bg-white p-5 text-center shadow-[0_1px_2px_rgba(15,23,42,0.025)]">
        <p className="text-3xl font-semibold tracking-tight text-slate-950">{headroomValue}</p>
        <p className="mt-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">Safe headroom</p>
        <p className="mt-1 text-xs text-slate-500">{headroomHint}</p>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <section
          aria-label="Today"
          className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)]"
        >
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Today</h2>
          <dl className="mt-3 space-y-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-500">Current provider usage</dt>
              <dd className="font-semibold text-slate-950">{providerPct}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-500">Safe ceiling</dt>
              <dd className="font-semibold text-slate-950">{safePct}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-slate-500">Provider remaining</dt>
              <dd className="font-semibold text-slate-950">{remainingValue}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-2.5">
              <dt className="text-slate-500">Safe contract headroom</dt>
              <dd className="font-semibold text-slate-950">{headroomValue}</dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] leading-5 text-slate-400">
            Provider remaining is what is left to 100%. Safe headroom is what is left to your safe
            ceiling. They are different numbers.
          </p>
        </section>

        <section
          aria-label="Next safe checkpoint"
          className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)]"
        >
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Next safe checkpoint
          </h2>
          {comparison.nextCheckpoint ? (
            <dl className="mt-3 space-y-2.5 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-500">Checkpoint</dt>
                <dd className="font-semibold text-slate-950">
                  {comparison.nextCheckpoint.date} at {comparison.nextCheckpoint.checkTime}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-500">Next ceiling</dt>
                <dd className="font-semibold text-slate-950">
                  {comparison.nextCeiling != null ? formatPercent(comparison.nextCeiling) : "—"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-slate-500">Room to next target</dt>
                <dd className="font-semibold text-slate-950">
                  {roomToNext == null ? "—" : formatPoints(roomToNext)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-2.5">
                <dt className="text-slate-500">Starts in</dt>
                <dd className="font-semibold text-slate-950">{countdownTo(comparison.msUntilNext)}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-slate-500">
              No further checkpoints this cycle. Reset is{" "}
              {formatCasablancaShort(contractMeta.resetAtIso)}.
            </p>
          )}
        </section>
      </div>

      <section
        aria-label="Plan versus reality"
        className="mt-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)]"
      >
        <h2 className="font-semibold text-slate-950">Plan vs reality</h2>
        <p className="mt-1 text-xs text-slate-500">
          Blue is your Safe Plan. Green dots are real provider observations — history is never
          invented.
        </p>
        <PaceChart points={chartPoints} nowMs={nowMs} />
      </section>

      <CheckpointTable checkpoints={checkpointRows} />

      <section
        aria-label="Monthly safe plan"
        className="mt-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)]"
      >
        <h2 className="font-semibold text-slate-950">Monthly Safe Plan</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex items-baseline justify-between gap-3 sm:block">
            <dt className="text-xs text-slate-500">File</dt>
            <dd className="font-medium text-slate-900">{contractMeta.filename ?? "—"}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 sm:block">
            <dt className="text-xs text-slate-500">Cycle</dt>
            <dd className="font-medium text-slate-900">
              {contractMeta.trackingStartIso.slice(0, 10)} → {contractMeta.resetAtIso.slice(0, 10)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 sm:block">
            <dt className="text-xs text-slate-500">Checkpoints</dt>
            <dd className="font-medium text-slate-900">{contractMeta.checkpointCount}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 sm:block">
            <dt className="text-xs text-slate-500">Daily check time</dt>
            <dd className="font-medium text-slate-900">{contractMeta.checkTime}</dd>
          </div>
        </dl>
        <details className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">View plan details</summary>
          <dl className="mt-2 space-y-1">
            <div className="flex justify-between gap-3">
              <dt>Baseline</dt>
              <dd>{formatPercent(contractMeta.baseline)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Planned ceiling</dt>
              <dd>{formatPercent(contractMeta.plannedCeiling)}</dd>
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
          </dl>
        </details>
      </section>

      {children}

      {history}
    </>
  );
}
