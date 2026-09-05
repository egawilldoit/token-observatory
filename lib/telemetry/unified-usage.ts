import type {
  CurrentDailyModelUsageRow,
  CurrentDailyUsageRow,
} from "@/lib/ccusage/types";
import type {
  RecoveredMonthlyUsage,
  RecoveredUsageEvidence,
  RecoveredUsageSetSummary,
} from "@/lib/recovery/types";

export const ALL_MACHINES = "all";
export const LOST_WINDOWS_PC_MACHINE_ID = "lost-windows-pc";
export const LOST_WINDOWS_PC_MACHINE_NAME = "Lost Windows PC";
export const RECOVERED_MACHINE_ID = LOST_WINDOWS_PC_MACHINE_ID;

export type UnifiedSourceKind = "canonical" | "recovered";
export type UnifiedRange = "all" | "7d" | "30d" | "90d";
export type UnifiedGranularity = "day" | "week" | "month";

type UnifiedTokenValues = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  accountingDeltaTokens: number;
  reportedCostUsd: number | null;
  pricingComplete: boolean;
};

export type UnifiedDailyUsage = UnifiedTokenValues & {
  usageDate: string;
  machineId: string;
  sourceKind: "canonical";
  agent: string;
};

export type UnifiedMonthlyUsage = UnifiedTokenValues & {
  month: string;
  machineId: string;
  sourceKind: UnifiedSourceKind;
  agent: string;
  models: string[];
  modelAttributionAvailable: boolean;
};

export type UnifiedModelUsageRow =
  | (UnifiedTokenValues & {
      kind: "canonical-attributed";
      sourceKind: "canonical";
      usageDate: string;
      machineId: string;
      agent: string;
      model: string;
    })
  | (UnifiedTokenValues & {
      kind: "canonical-unattributed";
      sourceKind: "canonical";
      usageDate: string;
      machineId: string;
      agent: string;
    })
  | (UnifiedTokenValues & {
      kind: "recovered-unattributed";
      sourceKind: "recovered";
      month: string;
      machineId: typeof LOST_WINDOWS_PC_MACHINE_ID;
      agent: string;
      knownModels: string[];
    });

export type UnifiedUsageProjection = {
  dailyRows: UnifiedDailyUsage[];
  monthlyRows: UnifiedMonthlyUsage[];
  modelRows: UnifiedModelUsageRow[];
  availableModels: string[];
  recoveredSet: RecoveredUsageSetSummary | null;
};

export type UnifiedUsageFilters = {
  machineId: string;
  agent: string;
  model: string;
  range: UnifiedRange;
  granularity: UnifiedGranularity;
};

export type UnifiedUsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  componentTotalTokens: number;
  accountingDeltaTokens: number;
  reportedCostUsd: number;
  costRows: number;
  rowCount: number;
  pricingComplete: boolean;
};

type ReadyUnifiedUsageSelection = {
  status: "ready";
  dailyRows: UnifiedDailyUsage[];
  monthlyRows: UnifiedMonthlyUsage[];
  modelRows: UnifiedModelUsageRow[];
  totals: UnifiedUsageTotals;
  recoveredInScope: boolean;
  modelAttributionExcluded: boolean;
  supportsDayWeek: boolean;
  supportsRollingRanges: boolean;
  effectiveRange: UnifiedRange;
};

type UnsupportedUnifiedUsageSelection = {
  status: "unsupported";
  reason: "recovered-month-only" | "recovered-all-time-only";
  recoveredInScope: boolean;
  modelAttributionExcluded: boolean;
  supportsDayWeek: boolean;
  supportsRollingRanges: boolean;
};

export type UnifiedUsageSelection =
  | ReadyUnifiedUsageSelection
  | UnsupportedUnifiedUsageSelection;

type AggregateKey = string;

function monthFromDate(value: string) {
  return value.slice(0, 7);
}

function addValues(
  current: UnifiedTokenValues,
  row: UnifiedTokenValues,
): UnifiedTokenValues {
  return {
    inputTokens: current.inputTokens + row.inputTokens,
    outputTokens: current.outputTokens + row.outputTokens,
    cacheCreationTokens:
      current.cacheCreationTokens + row.cacheCreationTokens,
    cacheReadTokens: current.cacheReadTokens + row.cacheReadTokens,
    totalTokens: current.totalTokens + row.totalTokens,
    accountingDeltaTokens:
      current.accountingDeltaTokens + row.accountingDeltaTokens,
    reportedCostUsd:
      current.reportedCostUsd === null || row.reportedCostUsd === null
        ? current.reportedCostUsd ?? row.reportedCostUsd
        : current.reportedCostUsd + row.reportedCostUsd,
    pricingComplete: current.pricingComplete && row.pricingComplete,
  };
}

function canonicalDailyRow(row: CurrentDailyUsageRow): UnifiedDailyUsage {
  return {
    usageDate: row.usage_date,
    machineId: row.machine_id,
    sourceKind: "canonical",
    agent: row.agent,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    cacheReadTokens: row.cache_read_tokens,
    totalTokens: row.reported_total_tokens,
    accountingDeltaTokens: row.accounting_delta_tokens,
    reportedCostUsd: row.reported_cost_usd,
    pricingComplete: row.reported_cost_usd !== null,
  };
}

function canonicalModelRow(
  row: CurrentDailyModelUsageRow,
): UnifiedModelUsageRow {
  return {
    kind: "canonical-attributed",
    sourceKind: "canonical",
    usageDate: row.usage_date,
    machineId: row.machine_id,
    agent: row.agent,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    cacheReadTokens: row.cache_read_tokens,
    totalTokens: row.reported_total_tokens,
    accountingDeltaTokens: row.accounting_delta_tokens,
    reportedCostUsd: row.reported_cost_usd,
    pricingComplete: row.reported_cost_usd !== null,
  };
}

function recoveredValues(
  row: RecoveredMonthlyUsage,
  pricingComplete: boolean,
): UnifiedTokenValues {
  return {
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    cacheReadTokens: row.cache_read_tokens,
    totalTokens: row.total_tokens,
    accountingDeltaTokens:
      row.total_tokens -
      row.input_tokens -
      row.output_tokens -
      row.cache_creation_tokens -
      row.cache_read_tokens,
    reportedCostUsd: row.reported_cost_usd,
    pricingComplete,
  };
}

function groupCanonicalDailyByMonth(
  dailyRows: UnifiedDailyUsage[],
  modelRows: UnifiedModelUsageRow[],
): UnifiedMonthlyUsage[] {
  const values = new Map<AggregateKey, UnifiedMonthlyUsage>();
  const modelNames = new Map<AggregateKey, Set<string>>();

  for (const row of modelRows) {
    if (row.kind !== "canonical-attributed") continue;
    const key = [monthFromDate(row.usageDate), row.machineId, row.agent].join("|");
    const names = modelNames.get(key) ?? new Set<string>();
    names.add(row.model);
    modelNames.set(key, names);
  }

  for (const row of dailyRows) {
    const month = monthFromDate(row.usageDate);
    const key = [month, row.machineId, row.agent].join("|");
    const current = values.get(key);
    if (current) {
      const next = addValues(current, row);
      values.set(key, {
        ...current,
        ...next,
      });
      continue;
    }

    const names = [...(modelNames.get(key) ?? [])].sort();
    values.set(key, {
      ...row,
      month,
      models: names,
      modelAttributionAvailable: names.length > 0,
    });
  }

  return [...values.values()].sort(monthlySort);
}

function monthlySort(a: UnifiedMonthlyUsage, b: UnifiedMonthlyUsage) {
  return (
    a.month.localeCompare(b.month) ||
    a.machineId.localeCompare(b.machineId) ||
    a.agent.localeCompare(b.agent)
  );
}

function recoveredProjectionRows(
  evidence: RecoveredUsageEvidence | null,
): UnifiedMonthlyUsage[] {
  if (!evidence) return [];

  const byMonth = new Map<string, RecoveredMonthlyUsage[]>();
  for (const row of evidence.rows) {
    const month = row.month.slice(0, 7);
    const rows = byMonth.get(month) ?? [];
    rows.push(row);
    byMonth.set(month, rows);
  }

  const projected: UnifiedMonthlyUsage[] = [];
  for (const [month, rows] of byMonth) {
    const agentRows = rows.filter((row) => row.agent !== "All");
    const rowsToUse = agentRows.length > 0 ? agentRows : rows;
    for (const row of rowsToUse) {
      const values = recoveredValues(
        row,
        evidence.set.pricing_complete && row.reported_cost_usd !== null,
      );
      projected.push({
        ...values,
        month,
        machineId: LOST_WINDOWS_PC_MACHINE_ID,
        sourceKind: "recovered",
        agent: row.agent,
        models: [...row.models],
        modelAttributionAvailable: false,
      });
    }
  }

  return projected.sort(monthlySort);
}

function canonicalUnattributedModelRows(
  dailyRows: UnifiedDailyUsage[],
  modelRows: UnifiedModelUsageRow[],
): UnifiedModelUsageRow[] {
  const attributedByDay = new Map<AggregateKey, UnifiedTokenValues>();

  for (const row of modelRows) {
    if (row.kind !== "canonical-attributed") continue;
    const key = [row.usageDate, row.machineId, row.agent].join("|");
    const current = attributedByDay.get(key);
    attributedByDay.set(
      key,
      current ? addValues(current, row) : { ...row },
    );
  }

  return dailyRows.flatMap((row) => {
    const attributed = attributedByDay.get(
      [row.usageDate, row.machineId, row.agent].join("|"),
    );
    const residual = {
      inputTokens: row.inputTokens - (attributed?.inputTokens ?? 0),
      outputTokens: row.outputTokens - (attributed?.outputTokens ?? 0),
      cacheCreationTokens:
        row.cacheCreationTokens - (attributed?.cacheCreationTokens ?? 0),
      cacheReadTokens: row.cacheReadTokens - (attributed?.cacheReadTokens ?? 0),
      totalTokens: row.totalTokens - (attributed?.totalTokens ?? 0),
      accountingDeltaTokens:
        row.accountingDeltaTokens - (attributed?.accountingDeltaTokens ?? 0),
    };

    if (
      residual.inputTokens === 0 &&
      residual.outputTokens === 0 &&
      residual.cacheCreationTokens === 0 &&
      residual.cacheReadTokens === 0 &&
      residual.totalTokens === 0 &&
      residual.accountingDeltaTokens === 0
    ) {
      return [];
    }

    const modelCost = attributed?.reportedCostUsd;
    const reportedCostUsd =
      row.reportedCostUsd === null
        ? null
        : !attributed
          ? row.reportedCostUsd
          : attributed.pricingComplete &&
              modelCost !== null &&
              modelCost !== undefined
            ? Number((row.reportedCostUsd - modelCost).toFixed(2))
            : null;

    return [
      {
        kind: "canonical-unattributed" as const,
        sourceKind: "canonical" as const,
        usageDate: row.usageDate,
        machineId: row.machineId,
        agent: row.agent,
        inputTokens: residual.inputTokens,
        outputTokens: residual.outputTokens,
        cacheCreationTokens: residual.cacheCreationTokens,
        cacheReadTokens: residual.cacheReadTokens,
        totalTokens: residual.totalTokens,
        accountingDeltaTokens: residual.accountingDeltaTokens,
        reportedCostUsd,
        pricingComplete: row.pricingComplete && reportedCostUsd !== null,
      },
    ];
  });
}

function recoveredModelRows(
  evidence: RecoveredUsageEvidence | null,
): UnifiedModelUsageRow[] {
  return recoveredProjectionRows(evidence).map((row) => ({
    kind: "recovered-unattributed",
    sourceKind: "recovered",
    month: row.month,
    machineId: LOST_WINDOWS_PC_MACHINE_ID,
    agent: row.agent,
    knownModels: [...row.models],
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    cacheReadTokens: row.cacheReadTokens,
    totalTokens: row.totalTokens,
    accountingDeltaTokens: row.accountingDeltaTokens,
    reportedCostUsd: row.reportedCostUsd,
    pricingComplete: row.pricingComplete,
  }));
}

export function buildUnifiedUsageProjection({
  canonicalDailyRows,
  canonicalModelRows,
  recoveredEvidence,
}: {
  canonicalDailyRows: CurrentDailyUsageRow[];
  canonicalModelRows: CurrentDailyModelUsageRow[];
  recoveredEvidence: RecoveredUsageEvidence | null;
}): UnifiedUsageProjection {
  const additiveRecoveredEvidence =
    recoveredEvidence?.set.accounting_mode === "additive_recovered"
      ? recoveredEvidence
      : null;
  const canonicalDaily = canonicalDailyRows
    .filter((row) => !row.global_duplicate && !row.is_tombstone)
    .map(canonicalDailyRow);
  const canonicalModels = canonicalModelRows
    .filter((row) => !row.global_duplicate && !row.is_tombstone)
    .map(canonicalModelRow);
  const recoveredMonthly = recoveredProjectionRows(additiveRecoveredEvidence);
  const canonicalUnattributed = canonicalUnattributedModelRows(
    canonicalDaily,
    canonicalModels,
  );

  return {
    dailyRows: canonicalDaily,
    monthlyRows: [...groupCanonicalDailyByMonth(canonicalDaily, canonicalModels), ...recoveredMonthly].sort(monthlySort),
    modelRows: [
      ...canonicalModels,
      ...canonicalUnattributed,
      ...recoveredModelRows(additiveRecoveredEvidence),
    ],
    availableModels: [
      ...new Set(
        canonicalModels
          .filter((row) => row.kind === "canonical-attributed")
          .map((row) => row.model),
      ),
    ].sort(),
    recoveredSet: additiveRecoveredEvidence?.set ?? null,
  };
}

function matchesMachine(machineId: string, selectedMachine: string) {
  return selectedMachine === ALL_MACHINES || machineId === selectedMachine;
}

function matchesAgent(agent: string, selectedAgent: string) {
  return selectedAgent === "all" || agent === selectedAgent;
}

function subtractDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function groupDailyRows(rows: UnifiedDailyUsage[]): UnifiedMonthlyUsage[] {
  const values = new Map<AggregateKey, UnifiedMonthlyUsage>();
  for (const row of rows) {
    const month = monthFromDate(row.usageDate);
    const key = [month, row.machineId, row.agent].join("|");
    const current = values.get(key);
    if (current) {
      const next = addValues(current, row);
      values.set(key, { ...current, ...next });
    } else {
      values.set(key, {
        ...row,
        month,
        models: [],
        modelAttributionAvailable: true,
      });
    }
  }
  return [...values.values()].sort(monthlySort);
}

function modelRowToDaily(row: Extract<UnifiedModelUsageRow, { kind: "canonical-attributed" }>): UnifiedDailyUsage {
  return {
    usageDate: row.usageDate,
    machineId: row.machineId,
    sourceKind: "canonical",
    agent: row.agent,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    cacheReadTokens: row.cacheReadTokens,
    totalTokens: row.totalTokens,
    accountingDeltaTokens: row.accountingDeltaTokens,
    reportedCostUsd: row.reportedCostUsd,
    pricingComplete: row.pricingComplete,
  };
}

function withRange<T extends { usageDate: string }>(
  rows: T[],
  rangeStart: string | null,
) {
  return rangeStart ? rows.filter((row) => row.usageDate >= rangeStart) : rows;
}

function filterModelRows(
  rows: UnifiedModelUsageRow[],
  filters: UnifiedUsageFilters,
  rangeStart: string | null,
  includeRecovered: boolean,
) {
  return rows.filter((row) => {
    if (!matchesMachine(row.machineId, filters.machineId) || !matchesAgent(row.agent, filters.agent)) {
      return false;
    }
    if (row.kind === "recovered-unattributed") {
      return includeRecovered;
    }
    if (row.kind === "canonical-unattributed") {
      return filters.model === "all" && (!rangeStart || row.usageDate >= rangeStart);
    }
    return (
      (filters.model === "all" || row.model === filters.model) &&
      (!rangeStart || row.usageDate >= rangeStart)
    );
  });
}

export function summarizeUnifiedUsage(
  rows: Array<UnifiedTokenValues>,
): UnifiedUsageTotals {
  const totals = rows.reduce<UnifiedUsageTotals>(
    (acc, row) => {
      acc.inputTokens += row.inputTokens;
      acc.outputTokens += row.outputTokens;
      acc.cacheCreationTokens += row.cacheCreationTokens;
      acc.cacheReadTokens += row.cacheReadTokens;
      acc.totalTokens += row.totalTokens;
      acc.accountingDeltaTokens += row.accountingDeltaTokens;
      acc.componentTotalTokens +=
        row.inputTokens +
        row.outputTokens +
        row.cacheCreationTokens +
        row.cacheReadTokens;
      acc.rowCount += 1;
      if (row.reportedCostUsd !== null) {
        acc.reportedCostUsd += row.reportedCostUsd;
        acc.costRows += 1;
      }
      acc.pricingComplete = acc.pricingComplete && row.pricingComplete;
      return acc;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 0,
      componentTotalTokens: 0,
      accountingDeltaTokens: 0,
      reportedCostUsd: 0,
      costRows: 0,
      rowCount: 0,
      pricingComplete: true,
    },
  );
  return { ...totals, reportedCostUsd: Number(totals.reportedCostUsd.toFixed(2)) };
}

export const summarizeUnifiedRows = summarizeUnifiedUsage;

export function selectUnifiedUsage(
  projection: UnifiedUsageProjection,
  filters: UnifiedUsageFilters,
): UnifiedUsageSelection {
  const recoveryScopeRows = projection.monthlyRows.filter(
    (row) =>
      row.sourceKind === "recovered" &&
      matchesMachine(row.machineId, filters.machineId) &&
      matchesAgent(row.agent, filters.agent),
  );
  const recoveredInScope = filters.model === "all" && recoveryScopeRows.length > 0;
  const modelAttributionExcluded = recoveryScopeRows.length > 0 && filters.model !== "all";
  const supportsDayWeek = !recoveredInScope;
  const supportsRollingRanges = !recoveredInScope;

  if (recoveredInScope && filters.granularity !== "month") {
    return {
      status: "unsupported",
      reason: "recovered-month-only",
      recoveredInScope,
      modelAttributionExcluded,
      supportsDayWeek,
      supportsRollingRanges,
    };
  }
  if (recoveredInScope && filters.range !== "all") {
    return {
      status: "unsupported",
      reason: "recovered-all-time-only",
      recoveredInScope,
      modelAttributionExcluded,
      supportsDayWeek,
      supportsRollingRanges,
    };
  }

  const effectiveRange = filters.range;

  const canonicalModelRows = projection.modelRows.filter(
    (row): row is Extract<UnifiedModelUsageRow, { kind: "canonical-attributed" }> =>
    row.kind === "canonical-attributed" &&
      matchesMachine(row.machineId, filters.machineId) &&
      matchesAgent(row.agent, filters.agent) &&
      (filters.model === "all" || row.model === filters.model),
  );
  const canonicalRowsForLatest =
    filters.model === "all"
      ? projection.dailyRows.filter(
          (row) =>
            matchesMachine(row.machineId, filters.machineId) &&
            matchesAgent(row.agent, filters.agent),
        )
      : canonicalModelRows.map(modelRowToDaily);
  const latestDate = [...canonicalRowsForLatest.map((row) => row.usageDate)].sort().at(-1) ?? null;
  const rangeStart =
    effectiveRange === "all" || !latestDate
      ? null
      : subtractDays(
          latestDate,
          effectiveRange === "7d" ? 6 : effectiveRange === "30d" ? 29 : 89,
        );

  const dailyRows = withRange(
    filters.model === "all"
      ? projection.dailyRows.filter(
          (row) =>
            matchesMachine(row.machineId, filters.machineId) &&
            matchesAgent(row.agent, filters.agent),
        )
      : canonicalRowsForLatest,
    rangeStart,
  );
  const monthlyRows =
    !rangeStart && filters.model === "all"
      ? projection.monthlyRows.filter(
          (row) =>
            matchesMachine(row.machineId, filters.machineId) &&
            matchesAgent(row.agent, filters.agent),
        )
      : groupDailyRows(dailyRows);
  const modelRows = filterModelRows(
    projection.modelRows,
    filters,
    rangeStart,
    recoveredInScope,
  ).filter((row) => filters.model === "all" || row.kind === "canonical-attributed");
  const totals = summarizeUnifiedUsage(
    filters.granularity === "month" ? monthlyRows : dailyRows,
  );

  return {
    status: "ready",
    dailyRows,
    monthlyRows,
    modelRows,
    totals,
    recoveredInScope,
    modelAttributionExcluded,
    supportsDayWeek,
    supportsRollingRanges,
    effectiveRange,
  };
}
