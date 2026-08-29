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
  coverage?: {
    scopeStart?: string | null;
    scopeEnd?: string | null;
  },
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
  coverage?: {
    scopeStart?: string | null;
    scopeEnd?: string | null;
  },
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
