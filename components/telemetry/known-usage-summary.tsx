"use client";

import { Database, Plus } from "lucide-react";

import type { KnownUsageTotals } from "@/lib/telemetry/known-usage-math";

function compact(value: number) {
  if (value >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(3).replace(/0+$/, "").replace(/\.$/, "") + "B";
  }
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  return value.toLocaleString();
}

export function KnownUsageSummary({ totals }: { totals: KnownUsageTotals }) {
  return (
    <section
      aria-labelledby="known-usage-heading"
      className="mt-7 overflow-hidden rounded-2xl border border-blue-200 bg-blue-50/60 shadow-[0_1px_2px_rgba(30,64,175,0.04)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-blue-200/80 px-5 py-5 md:px-6">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-100 text-blue-700">
            <Database className="h-4 w-4" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700">
              Overall accounting
            </p>
            <h2
              id="known-usage-heading"
              className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-950"
            >
              Total Known Usage
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
              Canonical detailed telemetry plus additive recovered monthly usage.
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-blue-300 bg-white/75 px-3 py-2 text-right">
          <p className="text-[10px] uppercase tracking-[0.12em] text-blue-700">
            Known total
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">
            {totals.knownTokens.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500">{compact(totals.knownTokens)} tokens</p>
        </div>
      </div>

      <div className="grid gap-3 px-5 py-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch md:px-6">
        <div className="rounded-xl border border-blue-200/80 bg-white/75 p-3">
          <p className="text-xs font-semibold text-slate-800">Canonical detailed telemetry</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">
            {compact(totals.canonicalTokens)}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {totals.canonicalTokens.toLocaleString()} · VM + normal ccusage imports
          </p>
        </div>
        <div className="hidden items-center justify-center text-blue-500 md:flex" aria-hidden="true">
          <Plus className="h-5 w-5" />
        </div>
        <div className="rounded-xl border border-amber-200/80 bg-amber-50/80 p-3">
          <p className="text-xs font-semibold text-slate-800">Recovered monthly telemetry</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">
            {compact(totals.additiveRecoveredTokens)}
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {totals.additiveRecoveredTokens.toLocaleString()} · Lost Windows PC · monthly-only
          </p>
        </div>
      </div>
    </section>
  );
}
