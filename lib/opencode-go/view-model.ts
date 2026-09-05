import { budgetRemaining, checkpointCeiling } from "./calculations";
import { evaluateTrackerStatus } from "./status";
import type { StoredSnapshot } from "./snapshot";

export type TrackerViewModel = {
  hasSnapshot: true;
  cycle: {
    trackingStartIso: string;
    resetAtIso: string;
    checkTime: string;
    baselineUsage: number;
    hardLimit: number;
    safetyReserve: number;
    plannedCeiling: number;
  };
  checkpoints: {
    day: number;
    date: string;
    checkTime: string;
    timestampMs: number;
    timestamp: string;
    ceiling: number;
    workbookCeiling: number | null;
    actual: number | null;
  }[];
  nowIso: string;
  status: ReturnType<typeof evaluateTrackerStatus>["status"];
  requiredDate: string | null;
  requiredCeiling: number | null;
  headroom: number | null;
  latestRecorded: ReturnType<typeof evaluateTrackerStatus>["latestRecorded"];
  remainingBudget: number;
  preFirstCheckpoint: boolean;
  formulaMismatchCount: number;
  formulaWarnings: StoredSnapshot["workbookDiagnostics"]["formulaWarnings"];
};

export function buildTrackerViewModel(snapshot: StoredSnapshot, nowMs: number): TrackerViewModel {
  const trackingStartMs = Date.parse(snapshot.trackingStartsAt);
  const resetAtMs = Date.parse(snapshot.resetAt);

  const checkpoints = snapshot.checkpoints.map((c) => ({
    ...c,
    timestampMs: Date.parse(c.timestamp),
    ceiling: checkpointCeiling({
      checkpointMs: Date.parse(c.timestamp),
      trackingStartMs,
      resetAtMs,
      baselineUsage: snapshot.baselineUsage,
      plannedCeilingValue: snapshot.plannedCeiling,
    }),
  }));

  const evaluated = evaluateTrackerStatus({
    nowMs,
    resetAtMs,
    hardLimit: snapshot.hardLimit,
    baselineUsage: snapshot.baselineUsage,
    checkpoints,
  });

  return {
    hasSnapshot: true,
    cycle: {
      trackingStartIso: snapshot.trackingStartsAt,
      resetAtIso: snapshot.resetAt,
      checkTime: snapshot.checkTime,
      baselineUsage: snapshot.baselineUsage,
      hardLimit: snapshot.hardLimit,
      safetyReserve: snapshot.safetyReserve,
      plannedCeiling: snapshot.plannedCeiling,
    },
    checkpoints,
    nowIso: new Date(nowMs).toISOString(),
    status: evaluated.status,
    requiredDate: evaluated.required?.date ?? null,
    requiredCeiling: evaluated.required?.ceiling ?? null,
    headroom: evaluated.headroom,
    latestRecorded: evaluated.latestRecorded,
    remainingBudget: budgetRemaining(snapshot.plannedCeiling, evaluated.latestRecorded.value),
    preFirstCheckpoint: evaluated.preFirstCheckpoint,
    formulaMismatchCount: snapshot.workbookDiagnostics.formulaMismatchCount,
    formulaWarnings: snapshot.workbookDiagnostics.formulaWarnings,
  };
}

export function formatPercent(fraction: number, digits: number = 2): string {
  return (fraction * 100).toFixed(digits) + "%";
}

export function formatPoints(fraction: number, digits: number = 2): string {
  const sign = fraction > 0 ? "+" : fraction < 0 ? "−" : "";
  return sign + Math.abs(fraction * 100).toFixed(digits) + " pp";
}
