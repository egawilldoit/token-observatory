import { modelUsageHash, usageHash } from "./hash";
import type {
  CurrentDailyModelUsageRow,
  CurrentDailyUsageRow,
  DailyModelUsageObservationInput,
  DailyUsageObservationInput,
  DiffSummary,
  ModelDiffSummary,
} from "./types";

function keyOf(row: Pick<DailyUsageObservationInput, "agent" | "usage_date">) {
  return row.agent + "|" + row.usage_date;
}

// ccusage snapshot absence is not deletion evidence.
//
// Normal ccusage exports are NOT authoritative proof that a historical row
// absent from a later overlapping export should be deleted. A missing
// machine × agent × date (or machine × agent × model × date) inside overlap
// must PRESERVE the latest accepted observation. A row may only be revised
// when the incoming snapshot explicitly contains that same key with changed
// counters. Automatic tombstoning from absence is forbidden; tombstones
// require explicit deletion evidence (allowMissingAsRemoval) or an explicit
// repair/unimport operation.

type OverlapCoverage = {
  scopeStart?: string | null;
  scopeEnd?: string | null;
  /**
   * Explicit opt-in for absence-as-removal. Defaults to false.
   * Normal snapshot reconciliation must leave this false/omitted so
   * missing keys are preserved. Only an explicit repair/unimport flow with
   * genuine deletion evidence may pass true.
   */
  allowMissingAsRemoval?: boolean;
};

function tombstoneFor(
  row: CurrentDailyUsageRow,
): DailyUsageObservationInput {
  const withoutHash = {
    agent: row.agent,
    usage_date: row.usage_date,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    reported_total_tokens: 0,
    accounting_delta_tokens: 0,
    reported_cost_usd: null,
    is_tombstone: true,
  };

  return {
    ...withoutHash,
    usage_hash: usageHash(withoutHash),
  };
}

export function diffDailyUsage(
  incoming: DailyUsageObservationInput[],
  current: CurrentDailyUsageRow[],
  coverage?: OverlapCoverage,
): DiffSummary {
  const currentByKey = new Map(
    current.map((row) => [keyOf(row), row] as const),
  );
  const projected = new Map<string, DailyUsageObservationInput>(
    current.map((row) => [keyOf(row), row] as const),
  );
  const incomingKeys = new Set(incoming.map(keyOf));
  const incomingDates = incoming.map((row) => row.usage_date).sort();
  const observedScopeStart = incomingDates[0] ?? null;
  const observedScopeEnd = incomingDates[incomingDates.length - 1] ?? null;
  const scopeStart = coverage?.scopeStart ?? observedScopeStart;
  const scopeEnd = coverage?.scopeEnd ?? observedScopeEnd;

  const newRows: DailyUsageObservationInput[] = [];
  const revisedRows: DailyUsageObservationInput[] = [];
  const removedRows: DailyUsageObservationInput[] = [];
  const unchangedRows: DailyUsageObservationInput[] = [];

  for (const row of incoming) {
    const existing = currentByKey.get(keyOf(row));

    if (!existing) {
      newRows.push(row);
      projected.set(keyOf(row), row);
      continue;
    }

    if (existing.usage_hash === row.usage_hash) {
      unchangedRows.push(row);
      continue;
    }

    revisedRows.push(row);
    projected.set(keyOf(row), row);
  }

  // Absence inside overlapping coverage is NOT removal unless the caller
  // explicitly opts in with allowMissingAsRemoval. Normal imports preserve
  // historical rows by omission.
  if (coverage?.allowMissingAsRemoval === true) {
    for (const existing of currentByKey.values()) {
      const key = keyOf(existing);
      const coveredBySnapshot =
        scopeStart !== null &&
        scopeEnd !== null &&
        existing.usage_date >= scopeStart &&
        existing.usage_date <= scopeEnd;

      if (coveredBySnapshot && !incomingKeys.has(key)) {
        removedRows.push(tombstoneFor(existing));
        projected.delete(key);
      }
    }
  }

  const beforeTotal = [...currentByKey.values()].reduce(
    (total, row) => total + row.reported_total_tokens,
    0,
  );
  const afterTotal = [...projected.values()].reduce(
    (total, row) => total + row.reported_total_tokens,
    0,
  );

  return {
    newRows,
    revisedRows,
    removedRows,
    unchangedRows,
    beforeTotal,
    afterTotal,
    netChange: afterTotal - beforeTotal,
  };
}


function modelKeyOf(
  row: Pick<
    DailyModelUsageObservationInput,
    "agent" | "model" | "usage_date"
  >,
) {
  return row.agent + "|" + row.model + "|" + row.usage_date;
}

function modelTombstoneFor(
  row: CurrentDailyModelUsageRow,
): DailyModelUsageObservationInput {
  const withoutHash = {
    agent: row.agent,
    model: row.model,
    usage_date: row.usage_date,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    reported_total_tokens: 0,
    accounting_delta_tokens: 0,
    reported_cost_usd: null,
    is_tombstone: true,
  };

  return {
    ...withoutHash,
    usage_hash: modelUsageHash(withoutHash),
  };
}

export function diffDailyModelUsage(
  incoming: DailyModelUsageObservationInput[],
  current: CurrentDailyModelUsageRow[],
  coverage?: OverlapCoverage,
): ModelDiffSummary {
  const currentByKey = new Map(
    current.map((row) => [modelKeyOf(row), row] as const),
  );
  const projected = new Map<string, DailyModelUsageObservationInput>(
    current.map((row) => [modelKeyOf(row), row] as const),
  );
  const incomingKeys = new Set(incoming.map(modelKeyOf));
  const incomingDates = incoming.map((row) => row.usage_date).sort();
  const observedScopeStart = incomingDates[0] ?? null;
  const observedScopeEnd = incomingDates[incomingDates.length - 1] ?? null;
  const scopeStart = coverage?.scopeStart ?? observedScopeStart;
  const scopeEnd = coverage?.scopeEnd ?? observedScopeEnd;

  const newRows: DailyModelUsageObservationInput[] = [];
  const revisedRows: DailyModelUsageObservationInput[] = [];
  const removedRows: DailyModelUsageObservationInput[] = [];
  const unchangedRows: DailyModelUsageObservationInput[] = [];

  for (const row of incoming) {
    const key = modelKeyOf(row);
    const existing = currentByKey.get(key);

    if (!existing) {
      newRows.push(row);
      projected.set(key, row);
      continue;
    }

    if (existing.usage_hash === row.usage_hash) {
      unchangedRows.push(row);
      continue;
    }

    revisedRows.push(row);
    projected.set(key, row);
  }

  // Same preservation rule as daily usage: missing model keys inside
  // overlap do not produce tombstones without explicit opt-in.
  if (coverage?.allowMissingAsRemoval === true) {
    for (const existing of currentByKey.values()) {
      const key = modelKeyOf(existing);
      const coveredBySnapshot =
        scopeStart !== null &&
        scopeEnd !== null &&
        existing.usage_date >= scopeStart &&
        existing.usage_date <= scopeEnd;

      if (coveredBySnapshot && !incomingKeys.has(key)) {
        removedRows.push(modelTombstoneFor(existing));
        projected.delete(key);
      }
    }
  }

  const beforeTotal = [...currentByKey.values()].reduce(
    (total, row) => total + row.reported_total_tokens,
    0,
  );
  const afterTotal = [...projected.values()].reduce(
    (total, row) => total + row.reported_total_tokens,
    0,
  );

  return {
    newRows,
    revisedRows,
    removedRows,
    unchangedRows,
    beforeTotal,
    afterTotal,
    netChange: afterTotal - beforeTotal,
  };
}
