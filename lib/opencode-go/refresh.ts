// SERVER-SIDE ONLY: import exclusively from route handlers (never the browser).
// The secret itself is read in `provider.ts` (real `import "server-only"`
// boundary) and passed in; this module never touches client-safe surfaces.

import { shouldStoreProviderSnapshot, V2_REFRESH_COOLDOWN_MS } from "./comparison";
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

  const latestTwo = await getLatestTwoProviderSnapshots(client);
  const previous = latestTwo[0] ?? null;

  // Backend refresh cooldown (~30-60s): skip the upstream write path when a
  // fresh observation already exists. The fetch above already happened; the
  // cooldown gate lives in the route before fetching. This second check keeps
  // concurrent refreshes from double-appending.
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

  const observedAtMs = fetched.fetchedAtMs - fetched.fetchDurationMs;
  const snapshot = await insertProviderSnapshot(client, {
    monthlyFraction: fetched.monthly.monthlyFraction,
    monthlyStatus: fetched.monthly.monthlyStatus,
    providerResetsAtIso: fetched.monthly.providerResetsAtIso,
    fetchDurationMs: fetched.fetchDurationMs,
    observedAtIso: new Date(observedAtMs).toISOString(),
    fetchedAtIso: new Date(fetched.fetchedAtMs).toISOString(),
  });
  return { ok: true, stored: true, snapshot, fetchDurationMs: fetched.fetchDurationMs };
}

export function refreshCooldownRemainingMs(nowMs: number, latestObservedAtMs: number | null): number {
  if (latestObservedAtMs == null) return 0;
  const remaining = V2_REFRESH_COOLDOWN_MS - (nowMs - latestObservedAtMs);
  return remaining > 0 ? remaining : 0;
}
