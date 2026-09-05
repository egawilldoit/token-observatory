import { checkpointCeiling, plannedCeiling } from "./calculations.js";
import { reconcileFormulas } from "./formula.js";
import type { OpenCodeGoParsedWorkbook } from "./types.js";

export type StoredCheckpoint = {
  day: number;
  date: string;
  checkTime: string;
  timestamp: string;
  ceiling: number;
  workbookCeiling: number | null;
  actual: number | null;
};

export type StoredSnapshot = {
  timezone: "Africa/Casablanca";
  trackingStartsAt: string;
  resetAt: string;
  checkTime: string;
  baselineUsage: number;
  hardLimit: number;
  safetyReserve: number;
  plannedCeiling: number;
  checkpoints: StoredCheckpoint[];
  latestRecordedActual: {
    value: number;
    source: "checkpoint" | "baseline";
    checkpointDate: string | null;
    checkpointTimestamp: string | null;
  };
  workbookDiagnostics: {
    formulaValuesAvailable: boolean;
    formulaMismatchCount: number;
    formulaWarnings: {
      field: string;
      checkpointDay?: number;
      workbookValue: number;
      applicationValue: number;
    }[];
  };
};

/** Canonical stored-snapshot builder shared by the import route. */
export function buildStoredSnapshot(parsed: OpenCodeGoParsedWorkbook): StoredSnapshot {
  const planned = plannedCeiling({ hardLimit: parsed.hardLimit, safetyReserve: parsed.safetyReserve });
  const reconciliation = reconcileFormulas(parsed);

  const checkpoints: StoredCheckpoint[] = parsed.checkpoints.map((c) => ({
    day: c.day,
    date: c.date,
    checkTime: c.checkTime,
    timestamp: new Date(c.timestampMs).toISOString(),
    ceiling: checkpointCeiling({
      checkpointMs: c.timestampMs,
      trackingStartMs: parsed.trackingStartMs,
      resetAtMs: parsed.resetAtMs,
      baselineUsage: parsed.baselineUsage,
      plannedCeilingValue: planned,
    }),
    workbookCeiling: c.ceiling,
    actual: c.actual,
  }));

  let latest: StoredSnapshot["latestRecordedActual"] = {
    value: parsed.baselineUsage,
    source: "baseline",
    checkpointDate: null,
    checkpointTimestamp: null,
  };
  for (const c of checkpoints) {
    if (c.actual != null) {
      latest = {
        value: c.actual,
        source: "checkpoint",
        checkpointDate: c.date,
        checkpointTimestamp: c.timestamp,
      };
    }
  }

  return {
    timezone: "Africa/Casablanca",
    trackingStartsAt: new Date(parsed.trackingStartMs).toISOString(),
    resetAt: new Date(parsed.resetAtMs).toISOString(),
    checkTime: parsed.checkTime,
    baselineUsage: parsed.baselineUsage,
    hardLimit: parsed.hardLimit,
    safetyReserve: parsed.safetyReserve,
    plannedCeiling: planned,
    checkpoints,
    latestRecordedActual: latest,
    workbookDiagnostics: {
      formulaValuesAvailable: reconciliation.formulaValuesAvailable,
      formulaMismatchCount: reconciliation.mismatchCount,
      formulaWarnings: reconciliation.warnings.slice(0, 50),
    },
  };
}
