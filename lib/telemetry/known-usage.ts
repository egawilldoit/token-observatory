import "server-only";

import { createAdminClient, isTelemetryConfigured } from "@/lib/supabase/admin";
import {
  combineKnownUsageTotals,
  type KnownUsageTotals,
  type CanonicalUsageTotalRow,
  type RecoveryUsageTotalRow,
} from "./known-usage-math";

export type { KnownUsageTotals } from "./known-usage-math";

export async function getKnownUsageTotals(): Promise<KnownUsageTotals> {
  if (!isTelemetryConfigured()) {
    return {
      canonicalTokens: 0,
      additiveRecoveredTokens: 0,
      knownTokens: 0,
    };
  }

  const supabase = createAdminClient();
  const [{ data: canonicalRows, error: canonicalError }, { data: recoveryRows, error: recoveryError }] =
    await Promise.all([
      supabase
        .from("v_current_daily_usage_dedupe")
        .select("reported_total_tokens,global_duplicate"),
      supabase
        .from("recovered_usage_sets")
        .select("total_tokens,accounting_mode"),
    ]);

  if (canonicalError) throw canonicalError;
  if (recoveryError) throw recoveryError;

  return combineKnownUsageTotals(
    (canonicalRows ?? []) as CanonicalUsageTotalRow[],
    (recoveryRows ?? []) as RecoveryUsageTotalRow[],
  );
}
