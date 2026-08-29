import assert from "node:assert/strict";
import test from "node:test";

import { diffDailyUsage } from "../lib/ccusage/diff";
import { parseCcusageDaily } from "../lib/ccusage/parser";
import { buildCcusageCommand, nextSinceFromDate } from "../lib/telemetry/config";
import type {
  CurrentDailyUsageRow,
  DailyUsageObservationInput,
} from "../lib/ccusage/types";

function fixture(total = 300) {
  return {
    daily: [
      {
        period: "2026-08-28",
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
          },
          {
            agent: "opencode",
            inputTokens: 50,
            outputTokens: 20,
            cacheReadTokens: 130,
            cacheCreationTokens: 0,
            totalTokens: 200,
            costUSD: 0,
          },
        ],
      },
    ],
  };
}

test("parses reconciled unified per-agent daily usage", () => {
  const parsed = parseCcusageDaily(fixture());

  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.scopeStart, "2026-08-28");
  assert.equal(parsed.scopeEnd, "2026-08-28");
  assert.equal(parsed.totals.reportedTotalTokens, 300);
  assert.deepEqual(parsed.agents, ["codex", "opencode"]);
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
