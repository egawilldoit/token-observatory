import type {
  CurrentDailyUsageRow,
  DailyUsageObservationInput,
  DiffSummary,
} from "./types";

function keyOf(row: Pick<DailyUsageObservationInput, "agent" | "usage_date">) {
  return row.agent + "|" + row.usage_date;
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

  const newRows: DailyUsageObservationInput[] = [];
  const revisedRows: DailyUsageObservationInput[] = [];
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
    unchangedRows,
    beforeTotal,
    afterTotal,
    netChange: afterTotal - beforeTotal,
  };
}
