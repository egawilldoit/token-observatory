import { createHash } from "node:crypto";

import type {
  DailyModelUsageObservationInput,
  DailyUsageObservationInput,
  SessionUsageObservationInput,
} from "./types";

function sha256Text(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

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

  return sha256Text(canonical);
}

export function modelUsageHash(
  row: Omit<DailyModelUsageObservationInput, "usage_hash">,
) {
  const canonical = [
    "ccusage-daily-agent-model-v1",
    row.agent,
    row.model,
    row.usage_date,
    row.input_tokens,
    row.output_tokens,
    row.cache_read_tokens,
    row.cache_creation_tokens,
    row.reported_total_tokens,
    row.reported_cost_usd === null ? "null" : row.reported_cost_usd,
    row.is_tombstone ? "tombstone" : "present",
  ].join("|");

  return sha256Text(canonical);
}

export function sessionHashes(
  row: Omit<
    SessionUsageObservationInput,
    "local_key_hash" | "identity_hash" | "mirror_hash" | "session_hash"
  > & { project_path?: string | null },
) {
  const project = row.project_path?.trim() ?? "";
  const models = [...row.models].sort().join(",");

  const local_key_hash = sha256Text(
    ["ccusage-session-local-v1", row.agent, row.session_id, project].join("|"),
  );
  const identity_hash = sha256Text(
    ["ccusage-session-identity-v1", row.agent, row.session_id].join("|"),
  );
  const mirror_hash = sha256Text(
    [
      "ccusage-session-mirror-v1",
      row.agent,
      row.session_id,
      row.first_activity ?? "",
      row.last_activity ?? "",
      row.input_tokens,
      row.output_tokens,
      row.cache_read_tokens,
      row.cache_creation_tokens,
      row.reported_total_tokens,
      models,
    ].join("|"),
  );
  const session_hash = sha256Text(
    [
      "ccusage-session-observation-v1",
      local_key_hash,
      mirror_hash,
      row.reported_cost_usd === null ? "null" : row.reported_cost_usd,
    ].join("|"),
  );

  return {
    local_key_hash,
    identity_hash,
    mirror_hash,
    session_hash,
  };
}
