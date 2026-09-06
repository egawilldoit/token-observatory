// SERVER-SIDE ONLY: the comparison is computed here, once, on the server.
// Client components receive the result as data and must not recompute it.

import {
  evaluateComparison,
  V2_HEADROOM_LOWER_EPS,
  V2_HEADROOM_UPPER_EPS,
  V2_NEAR_PLAN_HEADROOM,
  type V2Comparison,
  type V2Contract,
  type V2PreviousProvider,
  type V2ProviderReading,
} from "./comparison";
import type { OpenCodeGoProviderSnapshotRow } from "./provider-queries";
import type { StoredSnapshot } from "./snapshot";

export type V2ContractMeta = {
  filename: string | null;
  importedAt: string | null;
  trackingStartIso: string;
  resetAtIso: string;
  checkTime: string;
  baseline: number;
  hardLimit: number;
  safetyReserve: number;
  plannedCeiling: number;
  checkpointCount: number;
};

export type V2View = {
  hasContract: boolean;
  contractMeta: V2ContractMeta | null;
  contract: V2Contract | null;
  comparison: V2Comparison | null;
  providerSnapshot: OpenCodeGoProviderSnapshotRow | null;
  providerHistory: OpenCodeGoProviderSnapshotRow[];
  nowIso: string;
};

function toV2Contract(snapshot: StoredSnapshot): V2Contract {
  const trackingStartMs = Date.parse(snapshot.trackingStartsAt);
  const resetAtMs = Date.parse(snapshot.resetAt);
  return {
    baseline: snapshot.baselineUsage,
    trackingStartMs,
    resetAtMs,
    checkTime: snapshot.checkTime,
    hardLimit: snapshot.hardLimit,
    safetyReserve: snapshot.safetyReserve,
    plannedCeiling: snapshot.plannedCeiling,
    checkpoints: snapshot.checkpoints.map((c) => ({
      day: c.day,
      date: c.date,
      checkTime: c.checkTime,
      timestampMs: Date.parse(c.timestamp),
      timestamp: c.timestamp,
      ceiling: c.ceiling,
    })),
  };
}

function snapshotToReading(row: OpenCodeGoProviderSnapshotRow): V2ProviderReading {
  return {
    monthlyFraction: Number(row.monthly_percent),
    monthlyStatus: row.monthly_status,
    providerResetsAtMs: Date.parse(row.provider_resets_at),
    providerResetsAtIso: row.provider_resets_at,
    observedAtMs: Date.parse(row.observed_at),
  };
}

/**
 * Build the V2 page view server-side. The comparison is computed here, once,
 * and passed to client components as data. Client code must not recompute
 * status, headroom, freshness, or ceilings.
 */
export function buildV2View(args: {
  contractSnapshot: StoredSnapshot | null;
  contractMeta: Omit<V2ContractMeta, "checkpointCount"> & { checkpointCount?: number } | null;
  providerSnapshotsNewestFirst: OpenCodeGoProviderSnapshotRow[];
  nowMs: number;
}): V2View {
  const { contractSnapshot, contractMeta, providerSnapshotsNewestFirst, nowMs } = args;
  const nowIso = new Date(nowMs).toISOString();
  if (!contractSnapshot || !contractMeta) {
    const latest = providerSnapshotsNewestFirst[0] ?? null;
    return {
      hasContract: false,
      contractMeta: null,
      contract: null,
      comparison: null,
      providerSnapshot: latest,
      providerHistory: providerSnapshotsNewestFirst,
      nowIso,
    };
  }
  const contract = toV2Contract(contractSnapshot);
  // Contract-window scoping: the live comparison uses ONLY snapshots
  // observed inside the active contract
  // (trackingStartMs <= observed_at < resetAtMs). A prior-cycle reading must
  // never serve as the live truth for a new contract.
  const inWindow = providerSnapshotsNewestFirst.filter((row) => {
    const observedMs = Date.parse(row.observed_at);
    return (
      Number.isFinite(observedMs) &&
      observedMs >= contract.trackingStartMs &&
      observedMs < contract.resetAtMs
    );
  });
  const latest = inWindow[0] ?? null;
  const previousRow = inWindow[1] ?? null;
  const provider: V2ProviderReading | null = latest ? snapshotToReading(latest) : null;
  const previous: V2PreviousProvider | null = previousRow
    ? {
        resetsAtMs: Date.parse(previousRow.provider_resets_at),
        monthlyFraction: Number(previousRow.monthly_percent),
        observedAtMs: Date.parse(previousRow.observed_at),
      }
    : null;
  const comparison = evaluateComparison({ contract, nowMs, provider, previousProvider: previous });
  return {
    hasContract: true,
    contractMeta: {
      ...contractMeta,
      checkpointCount: contract.checkpoints.length,
    },
    contract,
    comparison,
    providerSnapshot: latest,
    providerHistory: providerSnapshotsNewestFirst,
    nowIso,
  };
}

export type V2CheckpointRow = {
  day: number;
  date: string;
  timestamp: string;
  ceiling: number;
  providerObservation: number | null;
  headroom: number | null;
  status: string;
  isCurrent: boolean;
  isFuture: boolean;
};

/** Same NEAR_PLAN band as evaluateComparison (shared constant + epsilons). */
function rowStatusForHeadroom(headroom: number, providerFraction: number): string {
  if (providerFraction >= 1) return "Limit exceeded";
  if (providerFraction < 0) return "—";
  if (headroom < V2_HEADROOM_LOWER_EPS) return "Over pace";
  if (headroom <= V2_NEAR_PLAN_HEADROOM + V2_HEADROOM_UPPER_EPS) return "Near plan";
  return "On track";
}

function comparisonStatusToRowLabel(status: string): string {
  switch (status) {
    case "ON_TRACK":
      return "On track";
    case "NEAR_PLAN":
      return "Near plan";
    case "OVER_PACE":
      return "Over pace";
    case "LIMIT_EXCEEDED":
      return "Limit exceeded";
    case "SYNC_STALE":
      return "Stale";
    case "RESET_REQUIRED":
      return "Reset required";
    default:
      return status;
  }
}

/**
 * Server-side checkpoint rows.
 *
 * Historical observations use a precise window rule, never calendar-date
 * matching: for a checkpoint at 12:00 with next checkpoint (or contract
 * reset) at T, the observation is the FIRST provider snapshot with
 * ` checkpoint.timestamp <= observed_at < T `. A 23:45 reading belongs to the
 * 12:00 window when nothing earlier exists; a 00:30 reading (before the
 * checkpoint) never does.
 *
 * Cycle scoping: only snapshots observed inside the active contract window
 * (`trackingStart <= observed_at < reset`) are eligible. Snapshots from a
 * prior/next monthly cycle are never shown against this contract. The active
 * row carries the live comparison values, but only when the latest snapshot
 * itself falls inside the contract window.
 *
 * Dates without snapshots show null (never invented). Future rows are
 * Upcoming.
 */
export function buildV2CheckpointRows(args: {
  contract: V2Contract;
  comparison: V2Comparison;
  providerHistoryNewestFirst: OpenCodeGoProviderSnapshotRow[];
  nowMs: number;
}): V2CheckpointRow[] {
  const { contract, comparison, providerHistoryNewestFirst, nowMs } = args;
  const sorted = [...contract.checkpoints].sort((a, b) => a.timestampMs - b.timestampMs);
  const activeDate = comparison.activeCheckpoint?.date ?? null;

  const inContract = providerHistoryNewestFirst.filter((row) => {
    const observedMs = Date.parse(row.observed_at);
    return (
      Number.isFinite(observedMs) &&
      observedMs >= contract.trackingStartMs &&
      observedMs < contract.resetAtMs
    );
  });
  const ascending = [...inContract].sort(
    (a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at),
  );

  function firstInWindow(windowStartMs: number, windowEndMs: number): OpenCodeGoProviderSnapshotRow | null {
    for (const row of ascending) {
      const observedMs = Date.parse(row.observed_at);
      if (observedMs >= windowStartMs && observedMs < windowEndMs) return row;
    }
    return null;
  }

  const latest = providerHistoryNewestFirst[0] ?? null;
  const latestObservedMs = latest ? Date.parse(latest.observed_at) : Number.NaN;
  const latestInContract =
    latest != null &&
    Number.isFinite(latestObservedMs) &&
    latestObservedMs >= contract.trackingStartMs &&
    latestObservedMs < contract.resetAtMs;

  return sorted.map((c, index) => {
    const windowEndMs =
      index + 1 < sorted.length ? (sorted[index + 1] as (typeof sorted)[number]).timestampMs : contract.resetAtMs;
    const isFuture = c.timestampMs > nowMs;
    const isCurrent = !isFuture && activeDate != null && c.date === activeDate;
    if (isFuture) {
      return {
        day: c.day,
        date: c.date,
        timestamp: c.timestamp,
        ceiling: c.ceiling,
        providerObservation: null,
        headroom: null,
        status: "Upcoming",
        isCurrent: false,
        isFuture: true,
      };
    }
    if (isCurrent) {
      if (!latestInContract) {
        return {
          day: c.day,
          date: c.date,
          timestamp: c.timestamp,
          ceiling: c.ceiling,
          providerObservation: null,
          headroom: null,
          status: comparisonStatusToRowLabel(comparison.status),
          isCurrent: true,
          isFuture: false,
        };
      }
      return {
        day: c.day,
        date: c.date,
        timestamp: c.timestamp,
        ceiling: c.ceiling,
        providerObservation: comparison.providerMonthly,
        headroom: comparison.safeHeadroom,
        status: comparisonStatusToRowLabel(comparison.status),
        isCurrent: true,
        isFuture: false,
      };
    }
    const aligned = firstInWindow(c.timestampMs, windowEndMs);
    if (!aligned) {
      return {
        day: c.day,
        date: c.date,
        timestamp: c.timestamp,
        ceiling: c.ceiling,
        providerObservation: null,
        headroom: null,
        status: "—",
        isCurrent: false,
        isFuture: false,
      };
    }
    const obs = Number(aligned.monthly_percent);
    const headroom = c.ceiling - obs;
    return {
      day: c.day,
      date: c.date,
      timestamp: c.timestamp,
      ceiling: c.ceiling,
      providerObservation: obs,
      headroom,
      status: rowStatusForHeadroom(headroom, obs),
      isCurrent: false,
      isFuture: false,
    };
  });
}

export type V2ChartPoint = {
  date: string;
  timestampMs: number;
  ceiling: number;
  providerObservation: number | null;
};

export function buildV2ChartPoints(rows: V2CheckpointRow[], contract: V2Contract): V2ChartPoint[] {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return [...contract.checkpoints]
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .map((c) => ({
      date: c.date,
      timestampMs: c.timestampMs,
      ceiling: c.ceiling,
      providerObservation: byDate.get(c.date)?.providerObservation ?? null,
    }));
}

export type { V2Comparison };
