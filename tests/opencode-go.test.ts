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
import { evaluateTrackerStatus } from "../lib/opencode-go/status.js";
import {
  buildEncryptedSignalZip,
  buildMinimalZip,
  buildOpenCodeGoWorkbookBuffer,
  buildOversizedEntryZip,
  buildTraversalZip,
  buildVbaZip,
} from "../lib/opencode-go/fixtures.js";
import {
  OPENCODE_GO_MAX_FILE_BYTES,
  preflightXlsxBuffer,
} from "../lib/opencode-go/xlsx-security.js";
import { parseOpenCodeGoWorkbook } from "../lib/opencode-go/parser.js";
import { reconcileFormulas } from "../lib/opencode-go/formula.js";
import { readFile, readdir } from "node:fs/promises";
import { OPENCODE_GO_BUCKET } from "../lib/opencode-go/config.js";
import {
  isSameCycle,
  selectActiveSnapshot,
  validateCorrection,
  validateSameCyclePlan,
} from "../lib/opencode-go/import-semantics.js";

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

describe("opencode-go freshness and status", () => {
  function snapshotWithActuals(actuals: Record<string, number | null>) {
    const checkpoints = generateCheckpoints({
      trackingStartMs: TRACKING_START,
      resetAtMs: RESET_AT,
      checkTime: "12:00",
    }).map((c) => {
      const t = casablancaWallToInstant(c.date, "12:00");
      const ceiling = checkpointCeiling({
        checkpointMs: t,
        trackingStartMs: TRACKING_START,
        resetAtMs: RESET_AT,
        baselineUsage: 0.048,
        plannedCeilingValue: 1.0,
      });
      return {
        ...c,
        timestampMs: t,
        ceiling,
        workbookCeiling: null as number | null,
        actual: (actuals[c.date] ?? null) as number | null,
      };
    });
    return checkpoints;
  }

  const SEP5_NOW = parseCasablancaDateTime("2026-09-05 14:29");

  it("reports UPDATE_DUE with baseline source when Sep 5 actual is missing", () => {
    const result = evaluateTrackerStatus({
      nowMs: SEP5_NOW,
      resetAtMs: RESET_AT,
      hardLimit: 1.0,
      baselineUsage: 0.048,
      checkpoints: snapshotWithActuals({}),
    });
    assert.equal(result.status, "UPDATE_DUE");
    assert.equal(result.latestRecorded.source, "baseline");
    assert.equal(result.latestRecorded.value, 0.048);
    assert.equal(result.headroom, null);
  });

  it("reports UPDATE_DUE with Sep 4 actual when Sep 5 is blank", () => {
    const result = evaluateTrackerStatus({
      nowMs: SEP5_NOW,
      resetAtMs: RESET_AT,
      hardLimit: 1.0,
      baselineUsage: 0.048,
      checkpoints: snapshotWithActuals({ "2026-09-03": 0.15, "2026-09-04": 0.18 }),
    });
    assert.equal(result.status, "UPDATE_DUE");
    assert.equal(result.latestRecorded.value, 0.18);
    assert.equal(result.latestRecorded.checkpointDate, "2026-09-04");
  });

  it("reports ON_TRACK for fresh 18.2% with headroom ≈ +4.53pp", () => {
    const result = evaluateTrackerStatus({
      nowMs: SEP5_NOW,
      resetAtMs: RESET_AT,
      hardLimit: 1.0,
      baselineUsage: 0.048,
      checkpoints: snapshotWithActuals({ "2026-09-05": 0.182 }),
    });
    assert.equal(result.status, "ON_TRACK");
    assert.ok(result.headroom != null && Math.abs(result.headroom - 0.0453) < 5e-4);
  });

  it("reports NEAR_LIMIT for fresh 21.7% with headroom ≈ +1.03pp", () => {
    const result = evaluateTrackerStatus({
      nowMs: SEP5_NOW,
      resetAtMs: RESET_AT,
      hardLimit: 1.0,
      baselineUsage: 0.048,
      checkpoints: snapshotWithActuals({ "2026-09-05": 0.217 }),
    });
    assert.equal(result.status, "NEAR_LIMIT");
    assert.ok(result.headroom != null && Math.abs(result.headroom - 0.0103) < 5e-4);
  });

  it("reports OVER_PACE for fresh 27.4%", () => {
    const result = evaluateTrackerStatus({
      nowMs: SEP5_NOW,
      resetAtMs: RESET_AT,
      hardLimit: 1.0,
      baselineUsage: 0.048,
      checkpoints: snapshotWithActuals({ "2026-09-05": 0.274 }),
    });
    assert.equal(result.status, "OVER_PACE");
    assert.ok(result.headroom != null && result.headroom < 0);
  });

  it("reports LIMIT_EXCEEDED at 100% even when the required checkpoint is blank", () => {
    const result = evaluateTrackerStatus({
      nowMs: SEP5_NOW,
      resetAtMs: RESET_AT,
      hardLimit: 1.0,
      baselineUsage: 0.048,
      checkpoints: snapshotWithActuals({ "2026-09-04": 1.0 }),
    });
    assert.equal(result.status, "LIMIT_EXCEEDED");
  });

  it("reports RESET_REQUIRED at or after reset", () => {
    const result = evaluateTrackerStatus({
      nowMs: RESET_AT,
      resetAtMs: RESET_AT,
      hardLimit: 1.0,
      baselineUsage: 0.048,
      checkpoints: snapshotWithActuals({}),
    });
    assert.equal(result.status, "RESET_REQUIRED");
  });

  it("qualifies pre-first-checkpoint as ON_TRACK without headroom", () => {
    const beforeFirst = parseCasablancaDateTime("2026-08-31 08:00");
    const result = evaluateTrackerStatus({
      nowMs: beforeFirst,
      resetAtMs: RESET_AT,
      hardLimit: 1.0,
      baselineUsage: 0.048,
      checkpoints: snapshotWithActuals({}),
    });
    assert.equal(result.status, "ON_TRACK");
    assert.equal(result.preFirstCheckpoint, true);
    assert.equal(result.headroom, null);
  });
});

describe("opencode-go deterministic fixtures", () => {
  it("generates a valid reference workbook deterministically", () => {
    const a = buildOpenCodeGoWorkbookBuffer({});
    const b = buildOpenCodeGoWorkbookBuffer({});
    assert.ok(a.length > 1024, "workbook should be non-trivial");
    assert.equal(a.length, b.length);
    assert.equal(Buffer.compare(a, b), 0);
    assert.ok(a.subarray(0, 2).toString() === "PK", "must be a ZIP container");
  });

  it("builds explicit-zero, missing-checkpoint, and duplicate variants", () => {
    const zero = buildOpenCodeGoWorkbookBuffer({ actuals: { "2026-08-31": 0 } });
    const missing = buildOpenCodeGoWorkbookBuffer({ dropDates: ["2026-09-05"] });
    const dup = buildOpenCodeGoWorkbookBuffer({ duplicateDate: "2026-09-05" });
    assert.ok(zero.length > 0 && missing.length > 0 && dup.length > 0);
    assert.notEqual(missing.length, buildOpenCodeGoWorkbookBuffer({}).length);
  });

  it("builds traversal, VBA, encryption, and oversized security fixtures", () => {
    assert.ok(buildTraversalZip().length > 0);
    assert.ok(buildVbaZip().length > 0);
    assert.ok(buildEncryptedSignalZip().length > 0);
    assert.ok(buildOversizedEntryZip(300).length > 0);
    assert.ok(buildMinimalZip([{ name: "a.txt", data: "hi" }]).length > 0);
  });
});

describe("opencode-go XLSX security preflight", () => {
  it("accepts the valid reference workbook", () => {
    const buf = buildOpenCodeGoWorkbookBuffer({});
    const result = preflightXlsxBuffer(buf, "tracker.xlsx");
    assert.equal(result.ok, true);
  });

  it("rejects a renamed non-ZIP file", () => {
    assert.throws(
      () => preflightXlsxBuffer(Buffer.from("this is not a zip", "utf8"), "tracker.xlsx"),
      /not_zip/,
    );
  });

  it("rejects malformed archives", () => {
    const buf = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("garbage")]);
    assert.throws(() => preflightXlsxBuffer(buf, "tracker.xlsx"), /malformed/);
  });

  it("rejects path traversal entries", () => {
    assert.throws(() => preflightXlsxBuffer(buildTraversalZip(), "tracker.xlsx"), /traversal/);
  });

  it("rejects macro/VBA content", () => {
    assert.throws(() => preflightXlsxBuffer(buildVbaZip(), "tracker.xlsx"), /macro/);
  });

  it("rejects encrypted content", () => {
    assert.throws(() => preflightXlsxBuffer(buildEncryptedSignalZip(), "tracker.xlsx"), /encrypted/);
  });

  it("rejects excessive entry counts", () => {
    assert.throws(() => preflightXlsxBuffer(buildOversizedEntryZip(300), "tracker.xlsx"), /too_many_entries/);
  });

  it("rejects oversized files", () => {
    const big = Buffer.alloc(OPENCODE_GO_MAX_FILE_BYTES + 1, 0);
    big.writeUInt32LE(0x04034b50, 0);
    assert.throws(() => preflightXlsxBuffer(big, "tracker.xlsx"), /too_large/);
  });

  it("rejects a valid ZIP missing OOXML structure", () => {
    const zip = buildMinimalZip([{ name: "hello.txt", data: "hi" }]);
    assert.throws(() => preflightXlsxBuffer(zip, "tracker.xlsx"), /unsupported_structure/);
  });
});

describe("opencode-go workbook parser", () => {
  it("parses the reference workbook contract", () => {
    const parsed = parseOpenCodeGoWorkbook(buildOpenCodeGoWorkbookBuffer({}));
    assert.equal(parsed.baselineUsage, 0.048);
    assert.equal(parsed.checkTime, "12:00");
    assert.equal(parsed.hardLimit, 1.0);
    assert.equal(parsed.safetyReserve, 0);
    assert.equal(parsed.checkpoints.length, 29);
    assert.equal(parsed.checkpoints[0]?.date, "2026-08-31");
    assert.equal(parsed.checkpoints[0]?.day, 1);
    assert.equal(parsed.checkpoints[28]?.date, "2026-09-28");
    assert.ok(parsed.checkpoints.every((c) => c.actual === null));
  });

  it("distinguishes blank (null) from explicit zero", () => {
    const parsed = parseOpenCodeGoWorkbook(
      buildOpenCodeGoWorkbookBuffer({ actuals: { "2026-08-31": 0 } }),
    );
    assert.equal(parsed.checkpoints[0]?.actual, 0);
    assert.equal(parsed.checkpoints[1]?.actual, null);
  });

  it("rejects a missing required sheet", () => {
    assert.throws(
      () => parseOpenCodeGoWorkbook(buildOpenCodeGoWorkbookBuffer({ omitSheet: true })),
      /missing_sheet/,
    );
  });

  it("rejects an incorrect title", () => {
    assert.throws(
      () => parseOpenCodeGoWorkbook(buildOpenCodeGoWorkbookBuffer({ title: "Wrong Title" })),
      /title/,
    );
  });

  it("rejects a dropped checkpoint as a schedule mismatch", () => {
    assert.throws(
      () => parseOpenCodeGoWorkbook(buildOpenCodeGoWorkbookBuffer({ dropDates: ["2026-09-05"] })),
      /schedule/,
    );
  });

  it("rejects duplicate checkpoints", () => {
    assert.throws(
      () => parseOpenCodeGoWorkbook(buildOpenCodeGoWorkbookBuffer({ duplicateDate: "2026-09-05" })),
      /duplicate/,
    );
  });

  it("rejects a decreasing actual sequence", () => {
    assert.throws(
      () =>
        parseOpenCodeGoWorkbook(
          buildOpenCodeGoWorkbookBuffer({ actuals: { "2026-09-03": 0.19, "2026-09-04": 0.175 } }),
        ),
      /monotonic/,
    );
  });

  it("rejects negative actuals", () => {
    assert.throws(
      () => parseOpenCodeGoWorkbook(buildOpenCodeGoWorkbookBuffer({ actuals: { "2026-09-03": -0.01 } })),
      /actual/,
    );
  });
});

describe("opencode-go formula diagnostics", () => {
  it("reports no warnings when cached values match", () => {
    const parsed = parseOpenCodeGoWorkbook(buildOpenCodeGoWorkbookBuffer({}));
    const result = reconcileFormulas(parsed);
    assert.equal(result.formulaValuesAvailable, true);
    assert.equal(result.mismatchCount, 0);
    assert.equal(result.warnings.length, 0);
  });

  it("reports warning-only mismatches without replacing app values", () => {
    const parsed = parseOpenCodeGoWorkbook(buildOpenCodeGoWorkbookBuffer({ ceilingSkew: 0.01 }));
    const result = reconcileFormulas(parsed);
    assert.ok(result.mismatchCount > 0);
    assert.ok(result.warnings.length > 0);
    assert.equal(result.applicationCeilings.length, parsed.checkpoints.length);
    const day1 = result.applicationCeilings.find((c) => c.day === 1);
    const skewed = parsed.formulaValues.find((f) => f.checkpointDay === 1);
    assert.ok(day1 && skewed && Math.abs(day1.ceiling - skewed.value) > 1e-6);
  });
});

describe("opencode-go persistence migration", () => {
  const MIGRATION = new URL(
    "../supabase/migrations/20260905_008_opencode_go_tracker.sql",
    import.meta.url,
  );

  it("creates an isolated opencode_go_imports domain with guards", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    assert.match(sql, /create table if not exists public\.opencode_go_imports/);
    assert.match(sql, /raw_sha256[\s\S]*where status in \('processing', 'processed'\)/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /revoke all on table public\.opencode_go_imports from anon, authenticated/);
    assert.match(sql, /grant all on table public\.opencode_go_imports to service_role/);
    assert.match(sql, /'opencode-go-imports'/);
  });

  it("never alters ccusage or recovered tables", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    const executable = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    for (const table of [
      "daily_usage_observations",
      "daily_model_usage_observations",
      "session_usage_observations",
      "cross_machine_daily_dedupe",
      "recovered_usage_sets",
      "recovered_monthly_usage",
    ]) {
      assert.doesNotMatch(executable, new RegExp(`(create|alter|insert|update|delete)[^;]*${table}`, "i"));
    }
    assert.doesNotMatch(executable, /process_ccusage_import_v3/);
  });

  it("is the next migration after 007 without renumbering history", async () => {
    const dir = new URL("../supabase/migrations/", import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    assert.ok(files.includes("20260905_006_recovered_monthly_usage.sql"));
    assert.ok(files.includes("20260905_007_recovered_additive_accounting.sql"));
    assert.ok(files.includes("20260905_008_opencode_go_tracker.sql"));
  });
});

describe("opencode-go query layer", () => {
  it("uses the private opencode-go bucket", () => {
    assert.equal(OPENCODE_GO_BUCKET, "opencode-go-imports");
  });

  it("queries processed snapshots with active-cycle ordering", async () => {
    const source = await readFile(
      new URL("../lib/opencode-go/queries.ts", import.meta.url),
      "utf8",
    );
    assert.match(source, /opencode_go_imports/);
    assert.match(source, /eq\("status", "processed"\)/);
    assert.match(source, /order\("tracking_start", \{ ascending: false \}\)/);
    assert.match(source, /order\("created_at", \{ ascending: false \}\)/);
    assert.match(source, /import "server-only"/);
    assert.doesNotMatch(source, /daily_usage_observations|cross_machine|recovered_/);
  });
});

describe("opencode-go import semantics", () => {
  const CYCLE_A = { trackingStartMs: 1000, resetAtMs: 2000 };
  const CYCLE_B = { trackingStartMs: 3000, resetAtMs: 4000 };
  const PLAN = {
    baselineUsage: 0.048,
    hardLimit: 1.0,
    safetyReserve: 0,
    plannedCeiling: 1.0,
    checkTime: "12:00",
    schedule: ["2026-08-31", "2026-09-01"],
  };

  it("recognizes the same cycle by tracking start and reset", () => {
    assert.equal(isSameCycle(CYCLE_A, { trackingStartMs: 1000, resetAtMs: 2000 }), true);
    assert.equal(isSameCycle(CYCLE_A, CYCLE_B), false);
  });

  it("rejects same-cycle plan drift", () => {
    assert.throws(
      () => validateSameCyclePlan(PLAN, { ...PLAN, baselineUsage: 0.05 }),
      /plan_drift/,
    );
    assert.throws(
      () => validateSameCyclePlan(PLAN, { ...PLAN, checkTime: "13:00" }),
      /plan_drift/,
    );
    validateSameCyclePlan(PLAN, { ...PLAN });
  });

  it("accepts filling a blank actual", () => {
    validateCorrection(
      [{ date: "2026-09-03", actual: 0.15 }, { date: "2026-09-04", actual: null }],
      [{ date: "2026-09-03", actual: 0.15 }, { date: "2026-09-04", actual: 0.18 }],
    );
  });

  it("accepts upward and downward corrections that stay monotonic", () => {
    validateCorrection(
      [{ date: "2026-09-03", actual: 0.15 }, { date: "2026-09-04", actual: 0.2 }],
      [{ date: "2026-09-03", actual: 0.15 }, { date: "2026-09-04", actual: 0.18 }],
    );
    validateCorrection(
      [{ date: "2026-09-03", actual: 0.15 }, { date: "2026-09-04", actual: 0.18 }],
      [{ date: "2026-09-03", actual: 0.16 }, { date: "2026-09-04", actual: 0.2 }],
    );
  });

  it("rejects corrections that break monotonicity", () => {
    assert.throws(
      () =>
        validateCorrection(
          [{ date: "2026-09-03", actual: 0.15 }, { date: "2026-09-04", actual: 0.18 }],
          [{ date: "2026-09-03", actual: 0.19 }, { date: "2026-09-04", actual: 0.175 }],
        ),
      /monotonic/,
    );
  });

  it("rejects non-null to null regression with 409 semantics", () => {
    assert.throws(
      () =>
        validateCorrection(
          [{ date: "2026-09-03", actual: 0.15 }, { date: "2026-09-04", actual: 0.18 }],
          [{ date: "2026-09-03", actual: 0.15 }, { date: "2026-09-04", actual: null }],
        ),
      /null_regression/,
    );
  });

  it("orders the active snapshot by cycle then server-created time", () => {
    const rows = [
      { id: "old-cycle-new-upload", status: "processed", tracking_start: "2026-08-30T21:29:00.000Z", created_at: "2026-09-06T10:00:00.000Z" },
      { id: "new-cycle", status: "processed", tracking_start: "2026-09-30T10:29:00.000Z", created_at: "2026-09-01T10:00:00.000Z" },
      { id: "same-cycle-older", status: "processed", tracking_start: "2026-09-30T10:29:00.000Z", created_at: "2026-09-01T09:00:00.000Z" },
      { id: "failed-newer", status: "failed", tracking_start: "2026-10-30T10:29:00.000Z", created_at: "2026-09-07T10:00:00.000Z" },
    ];
    assert.equal(selectActiveSnapshot(rows)?.id, "new-cycle");
    assert.equal(
      selectActiveSnapshot(rows.filter((r) => r.id !== "new-cycle"))?.id,
      "same-cycle-older",
    );
    assert.equal(selectActiveSnapshot([]), null);
  });
});
