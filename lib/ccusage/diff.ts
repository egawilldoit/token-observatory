import { usageHash } from "./hash";
import type {
  CurrentDailyUsageRow,
  DailyUsageObservationInput,
  DiffSummary,
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
): DiffSummary {
  const currentByKey = new Map(
    current.map((row) => [keyOf(row), row] as const),
  );
  const projected = new Map<string, DailyUsageObservationInput>(
    current.map((row) => [keyOf(row), row] as const),
  );
  const incomingKeys = new Set(incoming.map(keyOf));
  const incomingDates = new Set(incoming.map((row) => row.usage_date));

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
    if (incomingDates.has(existing.usage_date) && !incomingKeys.has(key)) {
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
