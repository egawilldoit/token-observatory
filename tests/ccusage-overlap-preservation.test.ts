import assert from "node:assert/strict";
import test from "node:test";

import { diffDailyModelUsage, diffDailyUsage } from "../lib/ccusage/diff";
import { modelUsageHash, usageHash } from "../lib/ccusage/hash";
import type {
  CurrentDailyModelUsageRow,
  CurrentDailyUsageRow,
  DailyModelUsageObservationInput,
  DailyUsageObservationInput,
} from "../lib/ccusage/types";

function makeDaily(
  agent: string,
  usage_date: string,
  reported_total_tokens: number,
  overrides: Partial<DailyUsageObservationInput> = {},
): DailyUsageObservationInput {
  const withoutHash = {
    agent,
    usage_date,
    input_tokens: reported_total_tokens,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    reported_total_tokens,
    accounting_delta_tokens: 0,
    reported_cost_usd: null,
    is_tombstone: false,
    ...overrides,
  };
  return {
    ...withoutHash,
    usage_hash: usageHash(withoutHash),
  };
}

function makeModel(
  agent: string,
  model: string,
  usage_date: string,
  reported_total_tokens: number,
): DailyModelUsageObservationInput {
  const withoutHash = {
    agent,
    model,
    usage_date,
    input_tokens: reported_total_tokens,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    reported_total_tokens,
    accounting_delta_tokens: 0,
    reported_cost_usd: null,
    is_tombstone: false,
  };
  return {
    ...withoutHash,
    usage_hash: modelUsageHash(withoutHash),
  };
}

function asCurrent(
  rows: DailyUsageObservationInput[],
): CurrentDailyUsageRow[] {
  return rows.map((row) => ({ ...row, machine_id: "the-vm" }));
}

function asCurrentModels(
  rows: DailyModelUsageObservationInput[],
): CurrentDailyModelUsageRow[] {
  return rows.map((row) => ({ ...row, machine_id: "the-vm" }));
}

test("daily overlap omission preserves historical OpenCode rows (incident regression)", () => {
  const current = asCurrent([
    makeDaily("codex", "2026-08-27", 1_000),
    makeDaily("hermes", "2026-08-27", 2_000),
    makeDaily("opencode", "2026-08-27", 207_790_480),
    makeDaily("codex", "2026-08-28", 1_000),
    makeDaily("hermes", "2026-08-28", 2_000),
    makeDaily("opencode", "2026-08-28", 1_642_946_820),
    makeDaily("codex", "2026-08-29", 1_000),
    makeDaily("hermes", "2026-08-29", 2_000),
    makeDaily("opencode", "2026-08-29", 369_407_169),
  ]);

  const incoming: DailyUsageObservationInput[] = [
    makeDaily("codex", "2026-08-27", 1_000),
    makeDaily("hermes", "2026-08-27", 2_000),
    makeDaily("codex", "2026-08-28", 1_000),
    makeDaily("hermes", "2026-08-28", 2_000),
    makeDaily("codex", "2026-08-29", 1_000),
    makeDaily("hermes", "2026-08-29", 2_000),
    makeDaily("codex", "2026-08-30", 5_000),
  ];

  const result = diffDailyUsage(incoming, current, {
    scopeStart: "2026-08-27",
    scopeEnd: "2026-08-30",
  });

  assert.equal(result.removedRows.length, 0);
  assert.equal(result.newRows.length, 1);
  assert.equal(result.newRows[0].agent, "codex");
  assert.equal(result.newRows[0].usage_date, "2026-08-30");
  assert.equal(result.netChange, 5_000);
  assert.equal(result.afterTotal, result.beforeTotal + 5_000);
});

test("daily overlap preserves history even when incoming scope starts later", () => {
  const current = asCurrent([
    makeDaily("opencode", "2026-08-27", 207_790_480),
    makeDaily("codex", "2026-08-27", 1_000),
    makeDaily("opencode", "2026-08-28", 1_642_946_820),
  ]);
  const incoming: DailyUsageObservationInput[] = [
    makeDaily("codex", "2026-08-27", 1_000),
    makeDaily("codex", "2026-08-30", 7_000),
  ];

  const result = diffDailyUsage(incoming, current, {
    scopeStart: "2026-08-27",
    scopeEnd: "2026-08-30",
  });

  assert.equal(result.removedRows.length, 0);
  assert.equal(result.afterTotal, result.beforeTotal + 7_000);
});

test("explicit same-key daily revision still revises", () => {
  const base = makeDaily("codex", "2026-08-27", 1_000);
  const current = asCurrent([base]);
  const incoming = [makeDaily("codex", "2026-08-27", 1_500)];

  const result = diffDailyUsage(incoming, current);

  assert.equal(result.revisedRows.length, 1);
  assert.equal(result.removedRows.length, 0);
  assert.equal(result.netChange, 500);
  assert.equal(result.afterTotal, 1_500);
});

test("lower counters on an explicitly present row revise downward", () => {
  const base = makeDaily("codex", "2026-08-27", 1_000);
  const current = asCurrent([base]);
  const incoming = [makeDaily("codex", "2026-08-27", 800)];

  const result = diffDailyUsage(incoming, current);

  assert.equal(result.revisedRows.length, 1);
  assert.equal(result.removedRows.length, 0);
  assert.equal(result.netChange, -200);
  assert.equal(result.afterTotal, 800);
});

test("exact duplicate daily import stays duplicate", () => {
  const base = makeDaily("codex", "2026-08-27", 1_000);
  const current = asCurrent([base]);
  const incoming = [makeDaily("codex", "2026-08-27", 1_000)];

  const result = diffDailyUsage(incoming, current);

  assert.equal(result.unchangedRows.length, 1);
  assert.equal(result.newRows.length, 0);
  assert.equal(result.revisedRows.length, 0);
  assert.equal(result.removedRows.length, 0);
  assert.equal(result.netChange, 0);
});

test("new agent/date daily rows append", () => {
  const current = asCurrent([makeDaily("codex", "2026-08-27", 1_000)]);
  const incoming = [
    makeDaily("codex", "2026-08-27", 1_000),
    makeDaily("opencode", "2026-08-27", 2_000),
    makeDaily("codex", "2026-08-28", 3_000),
  ];

  const result = diffDailyUsage(incoming, current);

  assert.equal(result.newRows.length, 2);
  assert.equal(result.removedRows.length, 0);
  assert.equal(result.netChange, 5_000);
});

test("no new import can erase history by omission across many dates", () => {
  const current = asCurrent([
    makeDaily("codex", "2026-08-26", 100),
    makeDaily("opencode", "2026-08-27", 207_790_480),
    makeDaily("opencode", "2026-08-28", 1_642_946_820),
    makeDaily("opencode", "2026-08-29", 369_407_169),
  ]);
  const incoming = [makeDaily("codex", "2026-09-08", 9_999)];

  const result = diffDailyUsage(incoming, current, {
    scopeStart: "2026-08-27",
    scopeEnd: "2026-09-08",
  });

  assert.equal(result.removedRows.length, 0);
  assert.equal(result.newRows.length, 1);
  assert.equal(result.netChange, 9_999);
});

test("model overlap omission preserves historical models", () => {
  const current = asCurrentModels([
    makeModel("opencode", "deepseek-v4-flash", "2026-08-27", 100_000),
    makeModel("opencode", "mimo-v2.5-free", "2026-08-27", 50_000),
    makeModel("codex", "gpt-5.6-sol", "2026-08-27", 1_000),
  ]);
  const incoming: DailyModelUsageObservationInput[] = [
    makeModel("codex", "gpt-5.6-sol", "2026-08-27", 1_000),
    makeModel("codex", "gpt-5.6-sol", "2026-08-30", 5_000),
  ];

  const result = diffDailyModelUsage(incoming, current, {
    scopeStart: "2026-08-27",
    scopeEnd: "2026-08-30",
  });

  assert.equal(result.removedRows.length, 0);
  assert.equal(result.newRows.length, 1);
  assert.equal(result.netChange, 5_000);
  assert.equal(result.afterTotal, result.beforeTotal + 5_000);
});

test("explicit same-key model revision still revises", () => {
  const current = asCurrentModels([
    makeModel("opencode", "deepseek-v4-flash", "2026-08-27", 1_000),
  ]);
  const incoming = [
    makeModel("opencode", "deepseek-v4-flash", "2026-08-27", 1_400),
  ];

  const result = diffDailyModelUsage(incoming, current);

  assert.equal(result.revisedRows.length, 1);
  assert.equal(result.removedRows.length, 0);
  assert.equal(result.netChange, 400);
});

test("lower counters on an explicitly present model row revise downward", () => {
  const current = asCurrentModels([
    makeModel("opencode", "deepseek-v4-flash", "2026-08-27", 1_000),
  ]);
  const incoming = [
    makeModel("opencode", "deepseek-v4-flash", "2026-08-27", 600),
  ];

  const result = diffDailyModelUsage(incoming, current);

  assert.equal(result.revisedRows.length, 1);
  assert.equal(result.removedRows.length, 0);
  assert.equal(result.netChange, -400);
  assert.equal(result.afterTotal, 600);
});

test("exact duplicate model import stays duplicate", () => {
  const current = asCurrentModels([
    makeModel("opencode", "deepseek-v4-flash", "2026-08-27", 1_000),
  ]);
  const incoming = [
    makeModel("opencode", "deepseek-v4-flash", "2026-08-27", 1_000),
  ];

  const result = diffDailyModelUsage(incoming, current);

  assert.equal(result.unchangedRows.length, 1);
  assert.equal(result.newRows.length, 0);
  assert.equal(result.revisedRows.length, 0);
  assert.equal(result.removedRows.length, 0);
  assert.equal(result.netChange, 0);
});

test("new model rows append without tombstoning siblings", () => {
  const current = asCurrentModels([
    makeModel("opencode", "deepseek-v4-flash", "2026-08-27", 1_000),
  ]);
  const incoming = [
    makeModel("opencode", "deepseek-v4-flash", "2026-08-27", 1_000),
    makeModel("opencode", "mimo-v2.5-free", "2026-08-27", 2_000),
  ];

  const result = diffDailyModelUsage(incoming, current);

  assert.equal(result.newRows.length, 1);
  assert.equal(result.removedRows.length, 0);
  assert.equal(result.netChange, 2_000);
});
