import assert from "node:assert/strict";
import test from "node:test";

import type {
  RecoveredMonthlyUsage,
  RecoveredUsageEvidence,
} from "../lib/recovery/types";
import {
  buildUnifiedUsageProjection,
  summarizeUnifiedRows,
} from "../lib/telemetry/unified-usage";

function recoveredRow(
  agent: string,
  total: number,
): RecoveredMonthlyUsage {
  return {
    id: `2026-05-${agent}`,
    recovery_set_id: "recovery-test",
    month: "2026-05-01",
    agent,
    input_tokens: total,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: total,
    reported_cost_usd: 0,
    models: agent === "All" ? [] : ["model-evidence-only"],
    created_at: "2026-09-05T00:00:00.000Z",
  };
}

function evidence(
  rows: RecoveredMonthlyUsage[],
  totalTokens: number,
): RecoveredUsageEvidence {
  return {
    set: {
      id: "recovery-test",
      description: "Recovered test evidence",
      source_type: "terminal_ccusage_monthly",
      source_machine_count: 1,
      suspected_mirror: false,
      accounting_mode: "additive_recovered",
      confidence: "exact_monthly_aggregate",
      granularity: "monthly_agent",
      total_input_tokens: totalTokens,
      total_output_tokens: 0,
      total_cache_creation_tokens: 0,
      total_cache_read_tokens: 0,
      total_tokens: totalTokens,
      reported_cost_usd: 0,
      pricing_complete: true,
      warnings: [],
      created_at: "2026-09-05T00:00:00.000Z",
    },
    rows,
  };
}

test("recovered projection falls back to the authoritative All row when agent rows are incomplete", () => {
  const projection = buildUnifiedUsageProjection({
    canonicalDailyRows: [],
    canonicalModelRows: [],
    recoveredEvidence: evidence(
      [recoveredRow("All", 100), recoveredRow("Codex", 40)],
      100,
    ),
  });

  const recoveredRows = projection.monthlyRows.filter(
    (row) => row.sourceKind === "recovered",
  );
  const totals = summarizeUnifiedRows(recoveredRows);

  assert.equal(recoveredRows.length, 1);
  assert.equal(recoveredRows[0]?.agent, "All");
  assert.equal(totals.totalTokens, 100);
});

test("recovered projection rejects aggregate monthly evidence that disagrees with the recovery-set total", () => {
  assert.throws(
    () =>
      buildUnifiedUsageProjection({
        canonicalDailyRows: [],
        canonicalModelRows: [],
        recoveredEvidence: evidence([recoveredRow("All", 100)], 101),
      }),
    /recovered usage integrity/i,
  );
});
