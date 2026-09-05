import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { generateCheckpoints } from "../lib/opencode-go/schedule.js";
import {
  budgetRemaining,
  checkpointCeiling,
  latestRecordedActual,
  plannedCeiling,
  remainingStartingBudget,
  validatePlanInputs,
} from "../lib/opencode-go/calculations.js";
import {
  casablancaWallToInstant,
  parseCasablancaDateTime,
} from "../lib/opencode-go/time.js";

const TRACKING_START = parseCasablancaDateTime("2026-08-30 22:29");
const RESET_AT = parseCasablancaDateTime("2026-09-29 11:29");

describe("opencode-go reference checkpoint contract", () => {
  it("generates 29 checkpoints from Aug 31 to Sep 28 at 12:00", () => {
    const checkpoints = generateCheckpoints({
      trackingStartMs: TRACKING_START,
      resetAtMs: RESET_AT,
      checkTime: "12:00",
    });
    assert.equal(checkpoints.length, 29);
    assert.equal(checkpoints[0]?.date, "2026-08-31");
    assert.equal(checkpoints[0]?.day, 1);
    assert.equal(checkpoints[28]?.date, "2026-09-28");
    assert.equal(checkpoints[28]?.day, 29);
  });

  it("excludes the tracking-start-day 12:00 candidate before tracking start", () => {
    const checkpoints = generateCheckpoints({
      trackingStartMs: TRACKING_START,
      resetAtMs: RESET_AT,
      checkTime: "12:00",
    });
    assert.ok(
      checkpoints.every((c) => c.timestampMs > TRACKING_START),
      "every checkpoint must be strictly after tracking start",
    );
    assert.ok(
      checkpoints.every((c) => c.timestampMs < RESET_AT),
      "every checkpoint must be strictly before reset",
    );
  });

  it("numbers days contiguously from 1", () => {
    const checkpoints = generateCheckpoints({
      trackingStartMs: TRACKING_START,
      resetAtMs: RESET_AT,
      checkTime: "12:00",
    });
    checkpoints.forEach((c, i) => assert.equal(c.day, i + 1));
  });
});

describe("opencode-go pacing calculations", () => {
  it("computes planned ceiling and remaining starting budget", () => {
    assert.equal(plannedCeiling({ hardLimit: 1.0, safetyReserve: 0 }), 1.0);
    assert.equal(
      remainingStartingBudget({ baselineUsage: 0.048, hardLimit: 1.0, safetyReserve: 0 }),
      0.952,
    );
  });

  it("recomputes the Sep 5 checkpoint ceiling to approximately 22.7278%", () => {
    const t = casablancaWallToInstant("2026-09-05", "12:00");
    const ceiling = checkpointCeiling({
      checkpointMs: t,
      trackingStartMs: TRACKING_START,
      resetAtMs: RESET_AT,
      baselineUsage: 0.048,
      plannedCeilingValue: 1.0,
    });
    assert.ok(
      Math.abs(ceiling - 0.2272776681) < 1e-6,
      `Sep 5 ceiling ${ceiling} should be ≈ 0.2272776681`,
    );
  });

  it("rejects invalid plan relationships", () => {
    assert.throws(() => validatePlanInputs({ baselineUsage: -0.1, hardLimit: 1, safetyReserve: 0 }));
    assert.throws(() => validatePlanInputs({ baselineUsage: 0.5, hardLimit: 0, safetyReserve: 0 }));
    assert.throws(() => validatePlanInputs({ baselineUsage: 1.2, hardLimit: 1, safetyReserve: 0 }));
  });

  it("falls back to baseline when no checkpoint actual exists", () => {
    const checkpoints = generateCheckpoints({
      trackingStartMs: TRACKING_START,
      resetAtMs: RESET_AT,
      checkTime: "12:00",
    }).map((c) => ({ ...c, actual: null as number | null }));
    const latest = latestRecordedActual(checkpoints, 0.048);
    assert.equal(latest.value, 0.048);
    assert.equal(latest.source, "baseline");
  });

  it("selects the most recent non-null checkpoint actual", () => {
    const checkpoints = generateCheckpoints({
      trackingStartMs: TRACKING_START,
      resetAtMs: RESET_AT,
      checkTime: "12:00",
    }).map((c) => ({ ...c, actual: null as number | null }));
    const idx3 = checkpoints.findIndex((c) => c.date === "2026-09-03");
    const idx4 = checkpoints.findIndex((c) => c.date === "2026-09-04");
    (checkpoints[idx3] as { actual: number | null }).actual = 0.15;
    (checkpoints[idx4] as { actual: number | null }).actual = 0.18;
    const latest = latestRecordedActual(checkpoints, 0.048);
    assert.equal(latest.value, 0.18);
    assert.equal(latest.source, "checkpoint");
    assert.equal(latest.checkpointDate, "2026-09-04");
  });

  it("distinguishes explicit zero from blank", () => {
    const checkpoints = generateCheckpoints({
      trackingStartMs: TRACKING_START,
      resetAtMs: RESET_AT,
      checkTime: "12:00",
    }).map((c) => ({ ...c, actual: null as number | null }));
    (checkpoints[0] as { actual: number | null }).actual = 0;
    const latest = latestRecordedActual(checkpoints, 0.048);
    assert.equal(latest.value, 0);
    assert.equal(latest.source, "checkpoint");
  });

  it("computes budget remaining floored at zero", () => {
    assert.ok(Math.abs(budgetRemaining(1.0, 0.182) - 0.818) < 1e-12);
    assert.equal(budgetRemaining(1.0, 1.4), 0);
  });
});
