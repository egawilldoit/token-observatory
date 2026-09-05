import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { generateCheckpoints } from "../lib/opencode-go/schedule.js";
import { parseCasablancaDateTime } from "../lib/opencode-go/time.js";

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
