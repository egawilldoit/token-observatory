import "server-only";

import { createAdminClient, isTelemetryConfigured } from "@/lib/supabase/admin";
import type {
  RecoveredMonthlyUsage,
  RecoveredUsageEvidence,
  RecoveredUsageSet,
  RecoveredUsageSetSummary,
} from "./types";

const RECOVERED_SET_ID = "lost-windows-history-2026-05-08";
const RECOVERED_SET_SUMMARY_COLUMNS =
  "id, description, source_type, source_machine_count, suspected_mirror, accounting_mode, confidence, granularity, total_input_tokens, total_output_tokens, total_cache_creation_tokens, total_cache_read_tokens, total_tokens, reported_cost_usd, pricing_complete, warnings, created_at";

export async function getRecoveredUsageSets(): Promise<RecoveredUsageSet[]> {
  if (!isTelemetryConfigured()) return [];

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("recovered_usage_sets")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as RecoveredUsageSet[];
}

export async function getRecoveredMonthlyRows(
  recoverySetId = RECOVERED_SET_ID,
): Promise<RecoveredMonthlyUsage[]> {
  if (!isTelemetryConfigured()) return [];

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("recovered_monthly_usage")
    .select("*")
    .eq("recovery_set_id", recoverySetId)
    .order("month", { ascending: true })
    .order("agent", { ascending: true });

  if (error) throw error;
  return (data ?? []) as RecoveredMonthlyUsage[];
}

export async function getLatestRecoveryEvidence(): Promise<RecoveredUsageEvidence | null> {
  if (!isTelemetryConfigured()) return null;

  const supabase = createAdminClient();
  const [{ data: sets, error: setsError }, rows] = await Promise.all([
    supabase
      .from("recovered_usage_sets")
      .select(RECOVERED_SET_SUMMARY_COLUMNS)
      .order("created_at", { ascending: false }),
    getRecoveredMonthlyRows(),
  ]);

  if (setsError) throw setsError;
  const set = sets[0];

  return set
    ? { set: set as RecoveredUsageSetSummary, rows }
    : null;
}
