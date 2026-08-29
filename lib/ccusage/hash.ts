import { createHash } from "node:crypto";

import type { DailyUsageObservationInput } from "./types";

export function sha256Buffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function usageHash(
  row: Omit<DailyUsageObservationInput, "usage_hash">,
) {
  const canonical = [
    "ccusage-daily-agent-v2",
    row.agent,
    row.usage_date,
    row.input_tokens,
    row.output_tokens,
    row.cache_read_tokens,
    row.cache_creation_tokens,
    row.reported_total_tokens,
    row.reported_cost_usd === null ? "null" : row.reported_cost_usd,
    row.is_tombstone ? "tombstone" : "present",
  ].join("|");

  return createHash("sha256").update(canonical).digest("hex");
}
