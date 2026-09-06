"use client";

import { useState } from "react";

import { formatPercent, formatPoints, formatWholePercent } from "@/lib/opencode-go/format";

export type V2CheckpointRow = {
  day: number;
  date: string;
  timestamp: string;
  ceiling: number;
  /** Real provider observation aligned to this checkpoint window, if any. */
  providerObservation: number | null;
  headroom: number | null;
  status: string;
  isCurrent: boolean;
  isFuture: boolean;
};

function badgeFor(status: string): string {
  switch (status) {
    case "Upcoming":
      return "border-slate-200 bg-slate-50 text-slate-500";
    case "On track":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "Near plan":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "Over pace":
      return "border-orange-200 bg-orange-50 text-orange-800";
    case "Limit exceeded":
      return "border-red-200 bg-red-50 text-red-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

/**
 * Deterministic default window: last 3 past checkpoints, the ACTIVE
 * checkpoint, and the next 5 checkpoints. Presentation only.
 */
export function selectDefaultRows(rows: V2CheckpointRow[]): V2CheckpointRow[] {
  const activeIdx = rows.findIndex((r) => r.isCurrent);
  if (activeIdx < 0) return rows.slice(0, 8);
  const past = rows.slice(0, activeIdx);
  const future = rows.slice(activeIdx + 1);
  return [...past.slice(-3), rows[activeIdx]!, ...future.slice(0, 5)];
}

function NoObservation({ card }: { card?: boolean }) {
  return (
    <span className={card ? "text-slate-400" : "text-slate-400"}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">No provider observation</span>
    </span>
  );
}

/**
 * Checkpoint history (Ledger).
 * - Future rows are UPCOMING, never missing.
 * - The ACTIVE row is strongly but discreetly highlighted.
 * - Collapsed by default to recent + ACTIVE + next 5.
 * - Desktop: compact tabular table. Mobile: cards.
 */
export function CheckpointTable({
  checkpoints,
  defaultExpanded = false,
}: {
  checkpoints: V2CheckpointRow[];
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const visible = expanded ? checkpoints : selectDefaultRows(checkpoints);
  const hidden = checkpoints.length - visible.length;

  return (
    <section
      aria-label="Checkpoint history"
      className="mt-3 rounded-xl border border-slate-200/90 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <h2 className="text-sm font-semibold text-slate-950">Checkpoint history</h2>

      <div className="mt-2 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[640px] text-left text-xs tabular-nums">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th scope="col" className="pb-2 font-medium">Date</th>
              <th scope="col" className="pb-2 font-medium">Safe ceiling</th>
              <th scope="col" className="pb-2 font-medium">Provider observation</th>
              <th scope="col" className="pb-2 font-medium">Headroom</th>
              <th scope="col" className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((row) => (
              <tr
                key={row.date}
                aria-current={row.isCurrent ? "true" : undefined}
                className={
                  row.isCurrent
                    ? "bg-blue-50/70 font-medium text-slate-900 shadow-[inset_2px_0_0_0_#2563eb]"
                    : row.isFuture
                      ? "text-slate-400"
                      : "text-slate-600"
                }
              >
                <td className="py-2 pr-4">
                  <span className="font-medium text-slate-800">{row.date}</span>
                  {row.isCurrent ? (
                    <span className="ml-2 rounded border border-blue-300 bg-blue-100 px-1.5 py-px text-[10px] font-bold tracking-wide text-blue-800">
                      ACTIVE
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-4">{formatPercent(row.ceiling)}</td>
                <td className="py-2 pr-4">
                  {row.providerObservation == null ? <NoObservation /> : formatWholePercent(row.providerObservation)}
                </td>
                <td className="py-2 pr-4">
                  {row.headroom == null ? <NoObservation /> : formatPoints(row.headroom)}
                </td>
                <td className="py-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeFor(row.status)}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-2 space-y-2 md:hidden">
        {visible.map((row) => (
          <li
            key={row.date}
            aria-current={row.isCurrent ? "true" : undefined}
            className={`rounded-lg border p-3 text-xs tabular-nums ${
              row.isCurrent
                ? "border-blue-300 bg-blue-50/70 text-slate-900"
                : row.isFuture
                  ? "border-slate-100 bg-slate-50/50 text-slate-400"
                  : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-slate-800">
                {row.date}
                {row.isCurrent ? <span className="ml-2 text-[10px] font-bold tracking-wide text-blue-700">ACTIVE</span> : null}
              </p>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeFor(row.status)}`}>
                {row.status}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-400">Safe ceiling</dt>
                <dd className="mt-0.5 font-medium">{formatPercent(row.ceiling)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-400">Provider</dt>
                <dd className="mt-0.5 font-medium">
                  {row.providerObservation == null ? <NoObservation card /> : formatWholePercent(row.providerObservation)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-400">Headroom</dt>
                <dd className="mt-0.5 font-medium">
                  {row.headroom == null ? <NoObservation card /> : formatPoints(row.headroom)}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      {hidden > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          {expanded ? "Show less" : `Show all ${checkpoints.length} checkpoints`}
        </button>
      ) : null}
    </section>
  );
}
