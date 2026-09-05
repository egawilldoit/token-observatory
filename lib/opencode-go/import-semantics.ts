export type CycleIdentity = {
  trackingStartMs: number;
  resetAtMs: number;
};

export type SameCyclePlan = {
  baselineUsage: number;
  hardLimit: number;
  safetyReserve: number;
  plannedCeiling: number;
  checkTime: string;
  schedule: string[];
};

export type ActualPoint = {
  date: string;
  actual: number | null;
};

export type SnapshotRow = {
  id: string;
  status: string;
  tracking_start: string;
  created_at: string;
};

export class OpenCodeGoConflictError extends Error {
  code: "plan_drift" | "null_regression" | "monotonic";
  constructor(code: "plan_drift" | "null_regression" | "monotonic", message: string) {
    super(`${code}: ${message}`);
    this.name = "OpenCodeGoConflictError";
    this.code = code;
  }
}

export function isSameCycle(a: CycleIdentity, b: CycleIdentity): boolean {
  return a.trackingStartMs === b.trackingStartMs && a.resetAtMs === b.resetAtMs;
}

export function validateSameCyclePlan(previous: SameCyclePlan, next: SameCyclePlan): void {
  const drifts =
    previous.baselineUsage !== next.baselineUsage ||
    previous.hardLimit !== next.hardLimit ||
    previous.safetyReserve !== next.safetyReserve ||
    previous.plannedCeiling !== next.plannedCeiling ||
    previous.checkTime !== next.checkTime ||
    previous.schedule.length !== next.schedule.length ||
    previous.schedule.some((d, i) => d !== next.schedule[i]);
  if (drifts) {
    throw new OpenCodeGoConflictError(
      "plan_drift",
      "same-cycle plan is frozen after the first accepted snapshot",
    );
  }
}

/**
 * Cross-import correction rules. `previous` is the latest accepted same-cycle
 * snapshot, `next` is the incoming complete sequence (same dates, same order).
 * Null may become non-null; non-null may move up or down; the resulting full
 * sequence must be non-decreasing; non-null may never become null.
 */
export function validateCorrection(previous: ActualPoint[], next: ActualPoint[]): void {
  if (previous.length !== next.length) {
    throw new OpenCodeGoConflictError("plan_drift", "same-cycle schedule changed between imports");
  }
  for (let i = 0; i < previous.length; i += 1) {
    const p = previous[i] as ActualPoint;
    const n = next[i] as ActualPoint;
    if (p.date !== n.date) {
      throw new OpenCodeGoConflictError("plan_drift", "same-cycle schedule changed between imports");
    }
    if (p.actual != null && n.actual == null) {
      throw new OpenCodeGoConflictError(
        "null_regression",
        `previously recorded actual for ${n.date} may not become blank`,
      );
    }
  }
  let last: number | null = null;
  for (const point of next) {
    if (point.actual != null) {
      if (last != null && point.actual < last) {
        throw new OpenCodeGoConflictError(
          "monotonic",
          `resulting actual sequence decreases at ${point.date}`,
        );
      }
      last = point.actual;
    }
  }
}

/**
 * Active snapshot selection over accepted history: tracking_start DESC,
 * then server-created created_at DESC. Only processed rows participate, so a
 * late upload of an older cycle never replaces a newer active cycle.
 */
export function selectActiveSnapshot<T extends SnapshotRow>(rows: T[]): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.status !== "processed") continue;
    if (
      !best ||
      row.tracking_start > best.tracking_start ||
      (row.tracking_start === best.tracking_start && row.created_at > best.created_at)
    ) {
      best = row;
    }
  }
  return best;
}
