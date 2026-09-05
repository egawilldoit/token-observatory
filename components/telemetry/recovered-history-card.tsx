"use client";

import { Archive, AlertTriangle, ShieldAlert } from "lucide-react";

import type { RecoveredUsageEvidence } from "@/lib/recovery/types";

function compact(value: number) {
  if (value >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(2).replace(/\.00$/, "") + "B";
  }
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  return value.toLocaleString();
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value + "T12:00:00Z"));
}

function money(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export function RecoveredHistoryCard({
  evidence,
}: {
  evidence: RecoveredUsageEvidence | null;
}) {
  if (!evidence) return null;

  const { set, rows } = evidence;
  const allRows = rows.filter((row) => row.agent === "All");

  return (
    <section
      aria-labelledby="recovered-history-heading"
      className="mt-7 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/60 shadow-[0_1px_2px_rgba(120,53,15,0.04)]"
    >
      <div className="border-b border-amber-200/80 px-5 py-5 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700">
              <Archive className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                Evidence archive
              </p>
              <h2
                id="recovered-history-heading"
                className="mt-1 text-lg font-semibold tracking-[-0.02em] text-slate-950"
              >
                Recovered History
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
                Two lost machines reported identical monthly ccusage history.
                Stored as one suspected-mirrored evidence dataset — never two
                copies of usage.
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-amber-300 bg-white/70 px-3 py-2 text-right">
            <p className="text-[10px] uppercase tracking-[0.12em] text-amber-700">
              Evidence only
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">
              {set.total_tokens.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500">{compact(set.total_tokens)} tokens</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 px-5 py-5 md:grid-cols-[minmax(0,1fr)_300px] md:px-6">
        <div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {allRows.map((row) => (
              <div
                key={row.id}
                className="rounded-xl border border-amber-200/80 bg-white/75 p-3"
              >
                <p className="text-xs font-medium text-slate-700">
                  {monthLabel(row.month)}
                </p>
                <p className="mt-1 text-lg font-semibold tabular-nums text-slate-950">
                  {compact(row.total_tokens)}
                </p>
                <p className="mt-0.5 text-[11px] tabular-nums text-slate-500">
                  {row.total_tokens.toLocaleString()} tokens
                </p>
              </div>
            ))}
          </div>

          <details className="mt-4 rounded-xl border border-amber-200/80 bg-white/50 p-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-700">
              Show monthly / agent evidence ({rows.length} rows)
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-xs">
                <thead className="text-[10px] uppercase tracking-[0.1em] text-slate-500">
                  <tr>
                    <th className="pb-2 font-medium">Month</th>
                    <th className="pb-2 font-medium">Agent</th>
                    <th className="pb-2 text-right font-medium">Total</th>
                    <th className="pb-2 text-right font-medium">Models listed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-100">
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 text-slate-600">{monthLabel(row.month)}</td>
                      <td className="py-2 font-medium text-slate-700">{row.agent}</td>
                      <td className="py-2 text-right tabular-nums text-slate-700">
                        {row.total_tokens.toLocaleString()}
                      </td>
                      <td className="py-2 text-right text-slate-500">
                        {row.models.length ? row.models.join(", ") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>

        <div className="space-y-2 text-xs text-slate-600">
          <div className="rounded-xl border border-amber-300 bg-white/70 p-3">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <p className="font-semibold text-slate-800">Not added to canonical telemetry</p>
                <p className="mt-1 leading-5">
                  This evidence does not enter daily, model, session, import, or
                  global-dedupe totals. Historical overlap is unknown.
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-amber-200/80 bg-white/50 p-3 leading-5">
            <p><span className="font-medium text-slate-700">Source:</span> {set.source_machine_count} lost machines; suspected mirror</p>
            <p><span className="font-medium text-slate-700">Confidence:</span> Exact monthly aggregates</p>
            <p><span className="font-medium text-slate-700">Granularity:</span> Monthly / agent only</p>
            <p><span className="font-medium text-slate-700">Reported cost:</span> {money(set.reported_cost_usd)}; pricing incomplete</p>
          </div>
          <div className="flex items-start gap-2 rounded-xl border border-amber-200/80 bg-white/50 p-3 leading-5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <span>Model names are preserved as evidence only. No per-model token totals were fabricated.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
