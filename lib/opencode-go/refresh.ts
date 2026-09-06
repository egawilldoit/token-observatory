// SERVER-SIDE ONLY: import exclusively from route handlers (never the browser).
// The secret itself is read in `provider.ts` (real `import "server-only"`
// boundary) and passed in; this module never touches client-safe surfaces.

import {
  shouldStoreProviderSnapshot,
  V2_REFRESH_COOLDOWN_MS,
  V2_RESET_TOLERANCE_MS,
  V2_SNAPSHOT_MAX_AGE_MS,
} from "./comparison";
import {
  fetchProviderMonthly,
  OpenCodeGoProviderError,
  type OpenCodeGoProviderErrorCode,
} from "./provider-schema";
import {
  getLatestTwoProviderSnapshots,
  insertProviderSnapshot,
  type OpenCodeGoProviderSnapshotRow,
  type SupabaseAdminLike,
} from "./provider-queries";

export type RefreshOutcome =
  | {
      ok: true;
      stored: boolean;
      snapshot: OpenCodeGoProviderSnapshotRow;
      fetchDurationMs: number;
    }
  | {
      ok: false;
      code: OpenCodeGoProviderErrorCode;
      message: string;
    };

export type RefreshDeps = {
  /** Resolved server key. Defaults to `OPENCODE_GO_API_KEY` from the environment. */
  apiKey?: string;
  fetchFn?: typeof fetch;
};

type AppendRpcResult =
  | { supported: true; stored: boolean; snapshot: OpenCodeGoProviderSnapshotRow }
  | { supported: false };

/**
 * Atomic append via migration 014 (`append_opencode_go_provider_snapshot`).
 * Returns `{ supported: false }` when the function does not exist yet so
 * callers fall back to the legacy path (pre-migration only). Any other
 * failure is a real storage error and is thrown.
 */
async function tryAppendRpc(
  client: SupabaseAdminLike,
  params: Record<string, unknown>,
): Promise<AppendRpcResult> {
  if (typeof client.rpc !== "function") return { supported: false };
  const { data, error } = await client.rpc("append_opencode_go_provider_snapshot", params);
  if (error) {
    if (/PGRST202|Could not find the function|404/.test(JSON.stringify(error))) {
      return { supported: false };
    }
    throw new Error("Could not store the provider observation.");
  }
  const parsed = data as { stored: boolean; snapshot: OpenCodeGoProviderSnapshotRow } | null;
  if (!parsed || typeof parsed.stored !== "boolean" || !parsed.snapshot) {
    throw new Error("Could not store the provider observation.");
  }
  return { supported: true, stored: parsed.stored, snapshot: parsed.snapshot };
}

/**
 * Fetch the live monthly usage and append a snapshot when the append rule
 * fires (% / status / reset changed beyond jitter tolerance, or last
 * observation >1h old).
 * Never throws for provider failures: they are returned as `{ ok: false }`
 * with a sanitized message so callers can preserve the last good snapshot.
 *
 * Timestamp semantics (the OpenCode API provides no observation timestamp):
 * - `observed_at` = when the request started (closest proxy for the state read)
 * - `fetched_at` = when the response was received
 */
export async function refreshProviderSnapshot(
  client: SupabaseAdminLike,
  nowMs: number = Date.now(),
  deps: RefreshDeps = {},
): Promise<RefreshOutcome> {
  const apiKey = deps.apiKey ?? process.env.OPENCODE_GO_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return { ok: false, code: "not_configured", message: "not_configured: Live usage is not configured" };
  }

  let fetched: Awaited<ReturnType<typeof fetchProviderMonthly>>;
  try {
    fetched = await fetchProviderMonthly({ apiKey, fetchFn: deps.fetchFn });
  } catch (error) {
    const code = error instanceof OpenCodeGoProviderError ? error.code : "network";
    return { ok: false, code, message: `${code}: Live usage is temporarily unavailable` };
  }

  const observedAtMs = fetched.fetchedAtMs - fetched.fetchDurationMs;
  const observedAtIso = new Date(observedAtMs).toISOString();
  const fetchedAtIso = new Date(fetched.fetchedAtMs).toISOString();

  // Preferred path (migration 014): atomic check-and-append inside one
  // transaction, so concurrent refreshes cannot double-append.
  const rpc = await tryAppendRpc(client, {
    p_monthly_percent: fetched.monthly.monthlyFraction,
    p_monthly_status: fetched.monthly.monthlyStatus,
    p_provider_resets_at: fetched.monthly.providerResetsAtIso,
    p_fetch_duration_ms: Math.max(0, Math.round(fetched.fetchDurationMs)),
    p_observed_at: observedAtIso,
    p_fetched_at: fetchedAtIso,
    p_cooldown_ms: V2_REFRESH_COOLDOWN_MS,
    p_max_age_ms: V2_SNAPSHOT_MAX_AGE_MS,
    p_reset_tolerance_ms: V2_RESET_TOLERANCE_MS,
  });
  if (rpc.supported) {
    return { ok: true, stored: rpc.stored, snapshot: rpc.snapshot, fetchDurationMs: fetched.fetchDurationMs };
  }

  // Legacy fallback (pre-014 only): read-decide-insert is race-prone but
  // keeps unmigrated environments working.
  const latestTwo = await getLatestTwoProviderSnapshots(client);
  const previous = latestTwo[0] ?? null;

  if (previous) {
    const ageMs = nowMs - Date.parse(previous.observed_at);
    if (ageMs < 0) {
      // Clock skew: treat as fresh, do not append.
      return { ok: true, stored: false, snapshot: previous, fetchDurationMs: fetched.fetchDurationMs };
    }
  }

  const shouldStore = shouldStoreProviderSnapshot({
    previous: previous
      ? {
          monthlyFraction: Number(previous.monthly_percent),
          monthlyStatus: previous.monthly_status,
          providerResetsAtMs: Date.parse(previous.provider_resets_at),
          observedAtMs: Date.parse(previous.observed_at),
        }
      : null,
    next: {
      monthlyFraction: fetched.monthly.monthlyFraction,
      monthlyStatus: fetched.monthly.monthlyStatus,
      providerResetsAtMs: fetched.monthly.providerResetsAtMs,
    },
    nowMs,
  });

  if (!shouldStore && previous) {
    return { ok: true, stored: false, snapshot: previous, fetchDurationMs: fetched.fetchDurationMs };
  }

  const snapshot = await insertProviderSnapshot(client, {
    monthlyFraction: fetched.monthly.monthlyFraction,
    monthlyStatus: fetched.monthly.monthlyStatus,
    providerResetsAtIso: fetched.monthly.providerResetsAtIso,
    fetchDurationMs: fetched.fetchDurationMs,
    observedAtIso,
    fetchedAtIso,
  });
  return { ok: true, stored: true, snapshot, fetchDurationMs: fetched.fetchDurationMs };
}

export function refreshCooldownRemainingMs(nowMs: number, latestObservedAtMs: number | null): number {
  if (latestObservedAtMs == null) return 0;
  const remaining = V2_REFRESH_COOLDOWN_MS - (nowMs - latestObservedAtMs);
  return remaining > 0 ? remaining : 0;
}
