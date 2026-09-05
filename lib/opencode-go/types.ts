export const OPENCODE_GO_TIMEZONE = "Africa/Casablanca" as const;

export type OpenCodeGoStatus =
  | "RESET_REQUIRED"
  | "LIMIT_EXCEEDED"
  | "UPDATE_DUE"
  | "OVER_PACE"
  | "NEAR_LIMIT"
  | "ON_TRACK";

export type OpenCodeGoCheckpoint = {
  day: number;
  date: string;
  checkTime: string;
  timestampMs: number;
  timestamp: string;
  ceiling: number;
  workbookCeiling: number | null;
  actual: number | null;
};

export type OpenCodeGoFormulaWarning = {
  field: string;
  checkpointDay?: number;
  workbookValue: number;
  applicationValue: number;
};

export type OpenCodeGoLatestRecorded = {
  value: number;
  source: "checkpoint" | "baseline";
  checkpointDate: string | null;
  checkpointTimestamp: string | null;
};

export type OpenCodeGoTrackerSnapshot = {
  timezone: typeof OPENCODE_GO_TIMEZONE;
  trackingStartsAt: string;
  resetAt: string;
  checkTime: string;
  baselineUsage: number;
  hardLimit: number;
  safetyReserve: number;
  plannedCeiling: number;
  checkpoints: OpenCodeGoCheckpoint[];
  latestRecordedActual: OpenCodeGoLatestRecorded;
  workbookDiagnostics: {
    formulaValuesAvailable: boolean;
    formulaMismatchCount: number;
    formulaWarnings: OpenCodeGoFormulaWarning[];
  };
};

export type OpenCodeGoPlanInputs = {
  baselineUsage: number;
  hardLimit: number;
  safetyReserve: number;
};

export type OpenCodeGoParsedWorkbook = {
  baselineUsage: number;
  trackingStartMs: number;
  resetAtMs: number;
  checkTime: string;
  hardLimit: number;
  safetyReserve: number;
  plannedCeiling: number | null;
  checkpoints: {
    day: number;
    date: string;
    checkTime: string;
    timestampMs: number;
    ceiling: number | null;
    actual: number | null;
  }[];
  formulaValues: {
    field: string;
    checkpointDay?: number;
    value: number;
  }[];
};
