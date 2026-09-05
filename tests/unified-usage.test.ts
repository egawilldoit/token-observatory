import assert from "node:assert/strict";
import test from "node:test";

import type {
  CurrentDailyModelUsageRow,
  CurrentDailyUsageRow,
} from "../lib/ccusage/types";
import type {
  RecoveredMonthlyUsage,
  RecoveredUsageEvidence,
} from "../lib/recovery/types";
import {
  RECOVERED_MACHINE_ID,
  buildUnifiedUsageProjection,
  selectUnifiedUsage,
  summarizeUnifiedRows,
} from "../lib/telemetry/unified-usage";

const recoveredRows: RecoveredMonthlyUsage[] = [
  recovered("2026-05", "All", 9172233, 760817, 104578084, 114511134, 120.94, []),
  recovered("2026-05", "Codex", 9162254, 760220, 104572672, 114495146, 120.90, ["gpt-5.5"]),
  recovered("2026-05", "Gemini CLI", 9979, 597, 5412, 15988, 0.04, ["gemini-3.1-pro-preview"]),
  recovered("2026-06", "All", 66366953, 6913485, 1324959636, 1398240074, 515.05, []),
  recovered("2026-06", "Codex", 53210093, 5142031, 837061376, 895413500, 496.05, ["gpt-5.4", "gpt-5.4-mini", "gpt-5.5"]),
  recovered("2026-06", "OpenCode", 13156860, 1771454, 487898260, 502826574, 19, ["deepseek-v4-flash", "deepseek-v4-flash-free", "deepseek-v4-pro", "mimo-v2.5-free", "minimax-m3"]),
  recovered("2026-07", "All", 104026745, 9579406, 2360740627, 2474346778, 329.02, []),
  recovered("2026-07", "Codex", 49931343, 3776798, 1069986560, 1123694701, 281.84, ["gpt-5.4-mini", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]),
  recovered("2026-07", "OpenCode", 54093230, 5802563, 1290754067, 1350649860, 47.18, ["deepseek-v4-flash", "deepseek-v4-flash-free", "deepseek-v4-pro", "gemini-3.6-flash", "hy3-free", "kimi-k3", "laguna-s-2.1-free", "mimo-v2.5"]),
  recovered("2026-07", "pi-agent", 2172, 45, 0, 2217, 0, ["[pi] deepseek-v4-flash"]),
  recovered("2026-08", "All", 123631901, 14944563, 5540616452, 5679192916, 421.18, []),
  recovered("2026-08", "Codex", 96385495, 10984851, 3978407168, 4085777514, 410.64, ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"]),
  recovered("2026-08", "OpenCode", 27246406, 3959712, 1562209284, 1593415402, 10.54, ["deepseek-v4-flash", "deepseek-v4-flash-free", "muse-spark-1.2-contributor-free", "ox-alpha-free"]),
];

const recoveredEvidence: RecoveredUsageEvidence = {
  set: {
    id: "lost-windows-history-2026-05-08",
    description: "Recovered ccusage monthly report from one permanently lost Windows PC",
    source_type: "terminal_ccusage_monthly",
    source_machine_count: 1,
    suspected_mirror: false,
    accounting_mode: "additive_recovered",
    confidence: "exact_monthly_aggregate",
    granularity: "monthly_agent",
    total_input_tokens: 303197832,
    total_output_tokens: 32198271,
    total_cache_creation_tokens: 0,
    total_cache_read_tokens: 9330894799,
    total_tokens: 9666290902,
    reported_cost_usd: 1386.19,
    pricing_complete: false,
    warnings: [
      "Missing pricing for laguna-s-2.1-free",
      "Missing pricing for ox-alpha-free",
    ],
    created_at: "2026-09-05T00:00:00.000Z",
  },
  rows: recoveredRows,
};

const canonicalRows: CurrentDailyUsageRow[] = [
  {
    id: "canonical-vm-2026-05-01",
    machine_id: "vm",
    agent: "Codex",
    usage_date: "2026-05-01",
    input_tokens: 100,
    output_tokens: 200,
    cache_creation_tokens: 300,
    cache_read_tokens: 8204456586,
    reported_total_tokens: 8204457186,
    accounting_delta_tokens: 0,
    reported_cost_usd: 20,
    is_tombstone: false,
    usage_hash: "canonical",
    global_duplicate: false,
  },
  {
    id: "duplicate-vm-2026-05-01",
    machine_id: "other-machine",
    agent: "Codex",
    usage_date: "2026-05-01",
    input_tokens: 123,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    reported_total_tokens: 123,
    accounting_delta_tokens: 0,
    reported_cost_usd: 1,
    is_tombstone: false,
    usage_hash: "duplicate",
    global_duplicate: true,
  },
];

const canonicalModelRows: CurrentDailyModelUsageRow[] = [
  {
    ...canonicalRows[0],
    model: "gpt-5.5",
  },
];

function recovered(
  month: string,
  agent: string,
  input: number,
  output: number,
  cacheRead: number,
  total: number,
  cost: number,
  models: string[],
): RecoveredMonthlyUsage {
  return {
    id: `${month}-${agent}`,
    recovery_set_id: "lost-windows-history-2026-05-08",
    month: `${month}-01`,
    agent,
    input_tokens: input,
    output_tokens: output,
    cache_creation_tokens: 0,
    cache_read_tokens: cacheRead,
    total_tokens: total,
    reported_cost_usd: cost,
    models,
    created_at: "2026-09-05T00:00:00.000Z",
  };
}

function projection() {
  return buildUnifiedUsageProjection({
    canonicalDailyRows: canonicalRows,
    canonicalModelRows,
    recoveredEvidence,
  });
}

test("unified projection preserves exact totals and components", () => {
  const result = projection();
  const totals = summarizeUnifiedRows(result.monthlyRows);

  assert.equal(result.monthlyRows.filter((row) => row.sourceKind === "recovered").length, 9);
  assert.equal(totals.inputTokens, 303197932);
  assert.equal(totals.outputTokens, 32198471);
  assert.equal(totals.cacheCreationTokens, 300);
  assert.equal(totals.cacheReadTokens, 9330894799 + 8204456586);
  assert.equal(totals.totalTokens, 17870748088);
  assert.equal(totals.componentTotalTokens, 17870748088);
  assert.equal(totals.reportedCostUsd, 1406.19);
  assert.equal(totals.pricingComplete, false);

  const recoveredTotals = summarizeUnifiedRows(
    result.monthlyRows.filter((row) => row.sourceKind === "recovered"),
  );
  assert.deepEqual(
    [
      recoveredTotals.inputTokens,
      recoveredTotals.outputTokens,
      recoveredTotals.cacheCreationTokens,
      recoveredTotals.cacheReadTokens,
      recoveredTotals.totalTokens,
    ],
    [303197832, 32198271, 0, 9330894799, 9666290902],
  );
  assert.equal(recoveredTotals.reportedCostUsd, 1386.19);
});

test("recovered terminal agent costs and model-name evidence are preserved exactly", () => {
  const expectedCosts = new Map([
    ["2026-05:All", 120.94],
    ["2026-05:Codex", 120.9],
    ["2026-05:Gemini CLI", 0.04],
    ["2026-06:All", 515.05],
    ["2026-06:Codex", 496.05],
    ["2026-06:OpenCode", 19],
    ["2026-07:All", 329.02],
    ["2026-07:Codex", 281.84],
    ["2026-07:OpenCode", 47.18],
    ["2026-07:pi-agent", 0],
    ["2026-08:All", 421.18],
    ["2026-08:Codex", 410.64],
    ["2026-08:OpenCode", 10.54],
  ]);
  for (const row of recoveredRows) {
    assert.equal(
      row.reported_cost_usd,
      expectedCosts.get(`${row.month.slice(0, 7)}:${row.agent}`),
      `${row.month} ${row.agent} cost`,
    );
  }

  const expectedModels = new Map([
    ["2026-05:Codex", ["gpt-5.5"]],
    ["2026-05:Gemini CLI", ["gemini-3.1-pro-preview"]],
    ["2026-06:Codex", ["gpt-5.4", "gpt-5.4-mini", "gpt-5.5"]],
    [
      "2026-06:OpenCode",
      [
        "deepseek-v4-flash",
        "deepseek-v4-flash-free",
        "deepseek-v4-pro",
        "mimo-v2.5-free",
        "minimax-m3",
      ],
    ],
    [
      "2026-07:Codex",
      ["gpt-5.4-mini", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"],
    ],
    [
      "2026-07:OpenCode",
      [
        "deepseek-v4-flash",
        "deepseek-v4-flash-free",
        "deepseek-v4-pro",
        "gemini-3.6-flash",
        "hy3-free",
        "kimi-k3",
        "laguna-s-2.1-free",
        "mimo-v2.5",
      ],
    ],
    ["2026-07:pi-agent", ["[pi] deepseek-v4-flash"]],
    [
      "2026-08:Codex",
      ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"],
    ],
    [
      "2026-08:OpenCode",
      [
        "deepseek-v4-flash",
        "deepseek-v4-flash-free",
        "muse-spark-1.2-contributor-free",
        "ox-alpha-free",
      ],
    ],
  ]);
  for (const row of recoveredRows.filter((item) => item.agent !== "All")) {
    assert.deepEqual(
      row.models,
      expectedModels.get(`${row.month.slice(0, 7)}:${row.agent}`),
      `${row.month} ${row.agent} models`,
    );
  }
});

test("unified filters merge agents and keep machines separate", () => {
  const result = projection();
  const all = selectUnifiedUsage(result, {
    machineId: "all",
    agent: "all",
    model: "all",
    range: "all",
    granularity: "month",
  });
  const vm = selectUnifiedUsage(result, {
    machineId: "vm",
    agent: "all",
    model: "all",
    range: "all",
    granularity: "month",
  });
  const lostPc = selectUnifiedUsage(result, {
    machineId: RECOVERED_MACHINE_ID,
    agent: "all",
    model: "all",
    range: "all",
    granularity: "month",
  });
  const codex = selectUnifiedUsage(result, {
    machineId: "all",
    agent: "Codex",
    model: "all",
    range: "all",
    granularity: "month",
  });

  assert.equal(all.status, "ready");
  assert.equal(all.status === "ready" ? all.totals.totalTokens : 0, 17870748088);
  assert.equal(vm.status === "ready" ? vm.totals.totalTokens : 0, 8204457186);
  assert.equal(lostPc.status === "ready" ? lostPc.totals.totalTokens : 0, 9666290902);
  assert.equal(codex.status === "ready" ? codex.totals.totalTokens : 0, 8204457186 + 114495146 + 895413500 + 1123694701 + 4085777514);

  if (all.status === "ready") {
    const agentTotals = new Map<string, number>();
    for (const row of all.monthlyRows) {
      agentTotals.set(row.agent, (agentTotals.get(row.agent) ?? 0) + row.totalTokens);
    }
    assert.deepEqual([...agentTotals.entries()].sort(), [
      ["Codex", 8204457186 + 114495146 + 895413500 + 1123694701 + 4085777514],
      ["Gemini CLI", 15988],
      ["OpenCode", 502826574 + 1350649860 + 1593415402],
      ["pi-agent", 2217],
    ].sort());
    assert.equal(
      [...agentTotals.values()].reduce((sum, value) => sum + value, 0),
      17870748088,
    );
  }
});

test("monthly output adds canonical grouped months to exact recovered months", () => {
  const result = projection();
  const selection = selectUnifiedUsage(result, {
    machineId: "all",
    agent: "all",
    model: "all",
    range: "all",
    granularity: "month",
  });

  assert.equal(selection.status, "ready");
  const monthlyTotals = new Map<string, number>();
  if (selection.status === "ready") {
    for (const row of selection.monthlyRows) {
      monthlyTotals.set(row.month, (monthlyTotals.get(row.month) ?? 0) + row.totalTokens);
    }
  }
  assert.deepEqual(
    [...monthlyTotals.entries()],
    [
      ["2026-05", 8318968320],
      ["2026-06", 1398240074],
      ["2026-07", 2474346778],
      ["2026-08", 5679192916],
    ],
  );
});

test("model evidence never becomes fabricated per-model allocation", () => {
  const result = projection();
  const allModels = selectUnifiedUsage(result, {
    machineId: "all",
    agent: "all",
    model: "all",
    range: "all",
    granularity: "month",
  });
  const specificModel = selectUnifiedUsage(result, {
    machineId: "all",
    agent: "all",
    model: "gpt-5.5",
    range: "all",
    granularity: "month",
  });

  assert.equal(allModels.status, "ready");
  assert.equal(
    allModels.status === "ready"
      ? allModels.modelRows.filter((row) => row.kind === "recovered-unattributed").length
      : 0,
    9,
  );
  if (allModels.status === "ready") {
    assert.equal(
      allModels.modelRows.reduce((total, row) => total + row.totalTokens, 0),
      allModels.totals.totalTokens,
    );
  }
  assert.deepEqual(
    allModels.status === "ready"
      ? allModels.modelRows.find((row) => row.kind === "recovered-unattributed")?.knownModels
      : [],
    ["gpt-5.5"],
  );
  assert.equal(specificModel.status, "ready");
  assert.equal(specificModel.status === "ready" ? specificModel.totals.totalTokens : 0, 8204457186);
  assert.equal(specificModel.status === "ready" ? specificModel.recoveredInScope : true, false);
  assert.equal(specificModel.status === "ready" ? specificModel.modelAttributionExcluded : false, true);
});

test("recovered monthly scope rejects rolling and day/week detail", () => {
  const result = projection();
  const day = selectUnifiedUsage(result, {
    machineId: "all",
    agent: "all",
    model: "all",
    range: "all",
    granularity: "day",
  });
  const rolling = selectUnifiedUsage(result, {
    machineId: "all",
    agent: "all",
    model: "all",
    range: "30d",
    granularity: "month",
  });
  const vmDay = selectUnifiedUsage(result, {
    machineId: "vm",
    agent: "all",
    model: "all",
    range: "30d",
    granularity: "day",
  });
  const lostPcDay = selectUnifiedUsage(result, {
    machineId: RECOVERED_MACHINE_ID,
    agent: "all",
    model: "all",
    range: "all",
    granularity: "day",
  });
  const lostPcWeek = selectUnifiedUsage(result, {
    machineId: RECOVERED_MACHINE_ID,
    agent: "all",
    model: "all",
    range: "all",
    granularity: "week",
  });
  const recoveredAgent = selectUnifiedUsage(result, {
    machineId: RECOVERED_MACHINE_ID,
    agent: "Gemini CLI",
    model: "all",
    range: "all",
    granularity: "month",
  });
  const lostPcModel = selectUnifiedUsage(result, {
    machineId: RECOVERED_MACHINE_ID,
    agent: "all",
    model: "gpt-5.5",
    range: "all",
    granularity: "month",
  });

  assert.equal(day.status, "unsupported");
  assert.equal(rolling.status, "unsupported");
  assert.equal(lostPcDay.status, "unsupported");
  assert.equal(lostPcWeek.status, "unsupported");
  assert.equal(
    recoveredAgent.status === "ready" ? recoveredAgent.totals.totalTokens : 0,
    15988,
  );
  assert.equal(lostPcModel.status, "ready");
  assert.equal(
    lostPcModel.status === "ready" ? lostPcModel.totals.totalTokens : 0,
    0,
  );
  assert.equal(
    lostPcModel.status === "ready" ? lostPcModel.modelAttributionExcluded : false,
    true,
  );
  assert.equal(vmDay.status, "ready");
});

test("model usage carries canonical residuals without assigning them to a model", () => {
  const partialModelRow = {
    ...canonicalModelRows[0],
    input_tokens: 40,
    reported_total_tokens: canonicalRows[0].reported_total_tokens - 60,
    reported_cost_usd: 10,
  };
  const result = buildUnifiedUsageProjection({
    canonicalDailyRows: canonicalRows,
    canonicalModelRows: [partialModelRow],
    recoveredEvidence: null,
  });
  const selection = selectUnifiedUsage(result, {
    machineId: "all",
    agent: "all",
    model: "all",
    range: "all",
    granularity: "month",
  });

  assert.equal(selection.status, "ready");
  if (selection.status === "ready") {
    const residual = selection.modelRows.find(
      (row) => row.kind === "canonical-unattributed",
    );
    assert.equal(residual?.inputTokens, 60);
    assert.equal(residual?.totalTokens, 60);
    assert.equal(
      selection.modelRows.reduce((total, row) => total + row.totalTokens, 0),
      selection.totals.totalTokens,
    );
  }
});

test("only additive recovery sets enter the unified projection", () => {
  const evidenceOnly = {
    ...recoveredEvidence,
    set: { ...recoveredEvidence.set, accounting_mode: "evidence_only_non_additive" },
  };
  const result = buildUnifiedUsageProjection({
    canonicalDailyRows: [],
    canonicalModelRows: [],
    recoveredEvidence: evidenceOnly,
  });

  assert.equal(result.recoveredSet, null);
  assert.equal(result.monthlyRows.length, 0);
  assert.equal(result.modelRows.length, 0);
});
