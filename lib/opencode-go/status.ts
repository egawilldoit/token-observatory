import { latestRecordedActual } from "./calculations.js";
import type { OpenCodeGoLatestRecorded, OpenCodeGoStatus } from "./types.js";

export const NEAR_LIMIT_HEADROOM = 0.02;

export type StatusCheckpoint = {
  day: number;
  date: string;
  checkTime: string;
  timestampMs: number;
  timestamp: string;
  ceiling: number;
  workbookCeiling: number | null;
  actual: number | null;
};

export type TrackerStatusResult = {
  status: OpenCodeGoStatus;
  required: StatusCheckpoint | null;
  latestRecorded: OpenCodeGoLatestRecorded;
  headroom: number | null;
  preFirstCheckpoint: boolean;
};

export function getRequiredCheckpoint(
  checkpoints: StatusCheckpoint[],
  nowMs: number,
): StatusCheckpoint | null {
  let required: StatusCheckpoint | null = null;
  for (const c of checkpoints) {
    if (c.timestampMs <= nowMs && (!required || c.timestampMs > required.timestampMs)) {
      required = c;
    }
  }
  return required;
}

export function evaluateTrackerStatus(args: {
  nowMs: number;
  resetAtMs: number;
  hardLimit: number;
  baselineUsage: number;
  checkpoints: StatusCheckpoint[];
}): TrackerStatusResult {
  const { nowMs, resetAtMs, hardLimit, baselineUsage, checkpoints } = args;

  const latestRecorded = latestRecordedActual(
    checkpoints.map((c) => ({
      timestampMs: c.timestampMs,
      date: c.date,
      timestamp: c.timestamp,
      actual: c.actual,
    })),
    baselineUsage,
  );

  if (nowMs >= resetAtMs) {
    return { status: "RESET_REQUIRED", required: getRequiredCheckpoint(checkpoints, nowMs), latestRecorded, headroom: null, preFirstCheckpoint: false };
  }

  if (latestRecorded.value >= hardLimit) {
    return { status: "LIMIT_EXCEEDED", required: getRequiredCheckpoint(checkpoints, nowMs), latestRecorded, headroom: null, preFirstCheckpoint: false };
  }

  const required = getRequiredCheckpoint(checkpoints, nowMs);

  if (!required) {
    return { status: "ON_TRACK", required: null, latestRecorded, headroom: null, preFirstCheckpoint: true };
  }

  if (required.actual == null) {
    return { status: "UPDATE_DUE", required, latestRecorded, headroom: null, preFirstCheckpoint: false };
  }

  const headroom = required.ceiling - (required.actual as number);

  if ((required.actual as number) > required.ceiling && (required.actual as number) < hardLimit) {
    return { status: "OVER_PACE", required, latestRecorded, headroom, preFirstCheckpoint: false };
  }

  if (headroom >= 0 && headroom <= NEAR_LIMIT_HEADROOM) {
    return { status: "NEAR_LIMIT", required, latestRecorded, headroom, preFirstCheckpoint: false };
  }

  return { status: "ON_TRACK", required, latestRecorded, headroom, preFirstCheckpoint: false };
}
