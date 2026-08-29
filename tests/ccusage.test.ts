import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  diffDailyModelUsage,
  diffDailyUsage,
} from "../lib/ccusage/diff";
import { parseCcusageDaily } from "../lib/ccusage/parser";
import {
  buildCcusageCommand,
  isFutureTelemetryDate,
  nextSinceFromDate,
  todayInTelemetryTimezone,
} from "../lib/telemetry/config";
import type {
  CurrentDailyModelUsageRow,
  CurrentDailyUsageRow,
  DailyModelUsageObservationInput,
  DailyUsageObservationInput,
} from "../lib/ccusage/types";

function fixture(total = 300) {
  return {
    daily: [
      {
        period: "2026-08-28",
        inputTokens: 90,
        outputTokens: 30,
        cacheReadTokens: 180,
        cacheCreationTokens: 0,
        totalTokens: total,
        agents: [
          {
            agent: "codex",
            inputTokens: 40,
            outputTokens: 10,
            cacheReadTokens: 50,
            cacheCreationTokens: 0,
            totalTokens: 100,
            costUSD: 0,
            modelsUsed: ["gpt-5.6-sol"],
            modelBreakdowns: [
              {
                modelName: "gpt-5.6-sol",
                inputTokens: 40,
                outputTokens: 10,
                cacheReadTokens: 50,
                cacheCreationTokens: 0,
                cost: 0,
              },
            ],
          },
          {
            agent: "opencode",
            inputTokens: 50,
            outputTokens: 20,
            cacheReadTokens: 130,
            cacheCreationTokens: 0,
            totalTokens: 200,
            costUSD: 0,
            modelsUsed: ["deepseek-v4-flash"],
            modelBreakdowns: [
              {
                modelName: "deepseek-v4-flash",
                inputTokens: 50,
                outputTokens: 20,
                cacheReadTokens: 130,
                cacheCreationTokens: 0,
                cost: 0,
              },
            ],
          },
        ],
      },
    ],
    totals: {
      inputTokens: 90,
      outputTokens: 30,
      cacheReadTokens: 180,
      cacheCreationTokens: 0,
      totalTokens: total,
    },
  };
}

test("parses reconciled unified per-agent daily usage", () => {
  const parsed = parseCcusageDaily(fixture());

  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.scopeStart, "2026-08-28");
  assert.equal(parsed.scopeEnd, "2026-08-28");
  assert.equal(parsed.totals.reportedTotalTokens, 300);
  assert.deepEqual(parsed.agents, ["codex", "opencode"]);
  assert.equal(parsed.modelRows.length, 2);
  assert.deepEqual(parsed.models, ["deepseek-v4-flash", "gpt-5.6-sol"]);
});

test("rejects impossible calendar dates", () => {
  const payload = fixture();
  payload.daily[0].period = "2026-02-31";

  assert.throws(() => parseCcusageDaily(payload), /valid YYYY-MM-DD date/);
});

test("rejects day totals that do not reconcile to agent totals", () => {
  assert.throws(() => parseCcusageDaily(fixture(301)), /do not reconcile/);
});

test("classifies overlap as unchanged, revised, and new", () => {
  const base = parseCcusageDaily(fixture()).rows;
  const current: CurrentDailyUsageRow[] = base.map((row) => ({
    ...row,
    machine_id: "openclaw",
  }));

  const revised: DailyUsageObservationInput = {
    ...base[0],
    reported_total_tokens: base[0].reported_total_tokens + 5,
    usage_hash: "revised-hash",
  };
  const newRow: DailyUsageObservationInput = {
    ...base[1],
    usage_date: "2026-08-29",
    usage_hash: "new-hash",
  };

  const result = diffDailyUsage([base[1], revised, newRow], current);

  assert.equal(result.unchangedRows.length, 1);
  assert.equal(result.revisedRows.length, 1);
  assert.equal(result.removedRows.length, 0);
  assert.equal(result.newRows.length, 1);
  assert.equal(result.netChange, 205);
});

test("builds a three-calendar-day overlap command", () => {
  assert.equal(nextSinceFromDate("2026-08-28"), "2026-08-26");
  assert.match(buildCcusageCommand("2026-08-26"), /--since 20260826/);
  assert.match(buildCcusageCommand("2026-08-26"), /ccusage@20\.0\.20/);
});


test("tombstones an agent removed from a covered day", () => {
  const parsed = parseCcusageDaily(fixture());
  const current = parsed.rows.map((row) => ({
    ...row,
    machine_id: "openclaw",
  }));
  const incoming = [parsed.rows[0]];

  const result = diffDailyUsage(incoming, current);

  assert.equal(result.removedRows.length, 1);
  assert.equal(result.removedRows[0].agent, "opencode");
  assert.equal(result.removedRows[0].is_tombstone, true);
  assert.equal(result.afterTotal, 100);
  assert.equal(result.netChange, -200);
});

test("cost-only changes create a new observation version", () => {
  const parsed = parseCcusageDaily(fixture());
  const current = parsed.rows.map((row) => ({
    ...row,
    machine_id: "openclaw",
  }));
  const changed = structuredClone(fixture());
  changed.daily[0].agents[0].costUSD = 1.25;
  const incoming = parseCcusageDaily(changed).rows;

  const result = diffDailyUsage(incoming, current);

  assert.equal(result.revisedRows.length, 1);
  assert.equal(result.netChange, 0);
});


test("database revision identity is per import, not per content hash", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260829_001_ccusage_v1.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /unique\(import_id, agent, usage_date\)/);
  assert.match(
    migration,
    /on conflict \(import_id, agent, usage_date\) do nothing/,
  );
  assert.doesNotMatch(
    migration,
    /unique\(machine_id, agent, usage_date, usage_hash\)/,
  );
});


test("rejects category totals that do not reconcile to agent rows", () => {
  const payload = fixture();
  payload.daily[0].cacheReadTokens = 181;

  assert.throws(
    () => parseCcusageDaily(payload),
    /cacheReadTokens do not reconcile/,
  );
});

test("rejects missing required token counters", () => {
  const payload = fixture();
  Reflect.deleteProperty(payload.daily[0].agents[0], "inputTokens");

  assert.throws(() => parseCcusageDaily(payload), /Invalid inputTokens/);
});


test("tombstones a whole missing day inside an overlapping snapshot", () => {
  const source = parseCcusageDaily(fixture()).rows[0];
  const current: CurrentDailyUsageRow[] = [
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
  ].map((usage_date) => ({
    ...source,
    usage_date,
    usage_hash: "hash-" + usage_date,
    machine_id: "openclaw",
  }));

  const incoming: DailyUsageObservationInput[] = [current[0], current[2]];

  const result = diffDailyUsage(incoming, current);

  assert.equal(result.removedRows.length, 1);
  assert.equal(result.removedRows[0].usage_date, "2026-08-27");
  assert.equal(result.netChange, -100);
});

test("uses the Africa/Casablanca calendar boundary for future-date rejection", () => {
  const now = new Date("2026-08-29T23:30:00Z");

  assert.equal(todayInTelemetryTimezone(now), "2026-08-30");
  assert.equal(isFutureTelemetryDate("2026-08-30", now), false);
  assert.equal(isFutureTelemetryDate("2026-08-31", now), true);
});

test("forward migration exposes accepted scope state independent of current usage rows", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260829_002_collection_state.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /v_machine_collection_state/);
  assert.match(
    migration,
    /max\(i\.scope_end\) filter \(where i\.status = 'processed'\)/,
  );
  assert.match(
    migration,
    /grant select on table public\.v_machine_collection_state to service_role/,
  );
});


test("rejects daily rows that disagree with top-level totals", () => {
  const payload = fixture();
  payload.totals.outputTokens = 31;

  assert.throws(
    () => parseCcusageDaily(payload),
    /Daily rows do not reconcile with top-level outputTokens/,
  );
});


test("tombstones a missing leading day when the server overlap starts earlier than visible rows", () => {
  const source = parseCcusageDaily(fixture()).rows[0];
  const current: CurrentDailyUsageRow[] = [
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
  ].map((usage_date) => ({
    ...source,
    usage_date,
    usage_hash: "current-" + usage_date,
    machine_id: "openclaw",
  }));
  const incoming: DailyUsageObservationInput[] = [current[1], current[2]];

  const result = diffDailyUsage(incoming, current, {
    scopeStart: "2026-08-26",
    scopeEnd: "2026-08-28",
  });

  assert.equal(result.removedRows.length, 1);
  assert.equal(result.removedRows[0].usage_date, "2026-08-26");
  assert.equal(result.netChange, -100);
});


test("rejects oversized or control-character agent identifiers", () => {
  const oversized = fixture();
  oversized.daily[0].agents[0].agent = "a".repeat(129);
  assert.throws(() => parseCcusageDaily(oversized), /missing a valid agent/);

  const controlled = fixture();
  controlled.daily[0].agents[0].agent = "codex\u0000hidden";
  assert.throws(() => parseCcusageDaily(controlled), /missing a valid agent/);
});


test("rejects model breakdown components that do not reconcile to the agent", () => {
  const payload = fixture();
  payload.daily[0].agents[0].modelBreakdowns[0].cacheReadTokens = 49;

  assert.throws(
    () => parseCcusageDaily(payload),
    /Per-model cacheReadTokens do not reconcile/,
  );
});

test("diffs model rows independently and tombstones removed models", () => {
  const parsed = parseCcusageDaily(fixture());
  const current: CurrentDailyModelUsageRow[] = parsed.modelRows.map((row) => ({
    ...row,
    machine_id: "openclaw",
  }));
  const incoming: DailyModelUsageObservationInput[] = [parsed.modelRows[0]];

  const result = diffDailyModelUsage(incoming, current);

  assert.equal(result.unchangedRows.length, 1);
  assert.equal(result.removedRows.length, 1);
  assert.equal(result.removedRows[0].model, "deepseek-v4-flash");
  assert.equal(result.removedRows[0].is_tombstone, true);
  assert.equal(result.afterTotal, 100);
});

test("model migration is forward-only and exposes canonical model state", async () => {
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260830_003_model_telemetry.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /daily_model_usage_observations/);
  assert.match(migration, /v_current_daily_model_usage/);
  assert.match(migration, /process_ccusage_import_v2/);
  assert.match(migration, /backfill_ccusage_models/);
  assert.match(
    migration,
    /unique\(import_id, agent, model, usage_date\)/,
  );
  assert.match(
    migration,
    /grant select on table public\.v_current_daily_model_usage to service_role/,
  );
});
