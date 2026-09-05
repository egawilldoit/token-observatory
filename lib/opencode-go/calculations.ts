import type { OpenCodeGoLatestRecorded } from "./types";

export function plannedCeiling(args: { hardLimit: number; safetyReserve: number }): number {
  const { hardLimit, safetyReserve } = args;
  if (!(hardLimit > 0)) throw new Error("hardLimit must be > 0");
  if (!(safetyReserve >= 0)) throw new Error("safetyReserve must be >= 0");
  if (!(safetyReserve < hardLimit)) throw new Error("safetyReserve must be < hardLimit");
  return hardLimit - safetyReserve;
}

export function remainingStartingBudget(args: {
  baselineUsage: number;
  hardLimit: number;
  safetyReserve: number;
}): number {
  validatePlanInputs(args);
  return plannedCeiling({ hardLimit: args.hardLimit, safetyReserve: args.safetyReserve }) - args.baselineUsage;
}

export function validatePlanInputs(args: {
  baselineUsage: number;
  hardLimit: number;
  safetyReserve: number;
}): void {
  const { baselineUsage, hardLimit, safetyReserve } = args;
  for (const [name, v] of [
    ["baselineUsage", baselineUsage],
    ["hardLimit", hardLimit],
    ["safetyReserve", safetyReserve],
  ] as const) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`${name} must be a finite number`);
    }
  }
  if (!(baselineUsage >= 0)) throw new Error("baselineUsage must be >= 0");
  if (!(hardLimit > 0)) throw new Error("hardLimit must be > 0");
  if (!(safetyReserve >= 0)) throw new Error("safetyReserve must be >= 0");
  if (!(safetyReserve < hardLimit)) throw new Error("safetyReserve must be < hardLimit");
  const planned = hardLimit - safetyReserve;
  if (!(baselineUsage <= planned)) {
    throw new Error("baselineUsage must be <= plannedCeiling");
  }
}

export function checkpointCeiling(args: {
  checkpointMs: number;
  trackingStartMs: number;
  resetAtMs: number;
  baselineUsage: number;
  plannedCeilingValue: number;
}): number {
  const { checkpointMs, trackingStartMs, resetAtMs, baselineUsage, plannedCeilingValue } = args;
  if (!(resetAtMs > trackingStartMs)) throw new Error("resetAt must be after trackingStart");
  const progress = (checkpointMs - trackingStartMs) / (resetAtMs - trackingStartMs);
  const raw = baselineUsage + (plannedCeilingValue - baselineUsage) * progress;
  return Math.max(baselineUsage, Math.min(plannedCeilingValue, raw));
}

export type ActualPoint = {
  timestampMs: number;
  date: string;
  timestamp: string;
  actual: number | null;
};

export function latestRecordedActual(
  checkpoints: ActualPoint[],
  baselineUsage: number,
): OpenCodeGoLatestRecorded {
  let latest: ActualPoint | null = null;
  for (const c of checkpoints) {
    if (c.actual != null) {
      if (typeof c.actual !== "number" || !Number.isFinite(c.actual) || c.actual < 0) {
        throw new Error("Actual Usage values must be finite and non-negative");
      }
      if (!latest || c.timestampMs > latest.timestampMs) latest = c;
    }
  }
  if (!latest) {
    return { value: baselineUsage, source: "baseline", checkpointDate: null, checkpointTimestamp: null };
  }
  return {
    value: latest.actual as number,
    source: "checkpoint",
    checkpointDate: latest.date,
    checkpointTimestamp: latest.timestamp,
  };
}

export function budgetRemaining(plannedCeilingValue: number, latestValue: number): number {
  return Math.max(0, plannedCeilingValue - latestValue);
}

export function headroomFor(requiredCeiling: number, requiredActual: number): number {
  return requiredCeiling - requiredActual;
}
