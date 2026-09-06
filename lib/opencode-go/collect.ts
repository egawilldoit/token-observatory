// SERVER-SIDE ONLY (via route handlers): collection orchestration with no
// browser surface. Pure dependency injection keeps every HTTP semantic
// unit-testable without importing secret-holding modules.

import {
  refreshProviderSnapshot,
  type RefreshOutcome,
} from "./refresh";
import type { SupabaseAdminLike } from "./provider-queries";

/** Constant-time bearer comparison (length-checked first). */
export function isCronAuthorized(cronSecret: string | null, authHeader: string | null): boolean {
  if (!cronSecret || !authHeader) return false;
  const expected = `Bearer ${cronSecret}`;
  if (authHeader.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= (authHeader.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

export type CollectDeps = {
  telemetryConfigured: boolean;
  /** Trimmed CRON_SECRET, or null when unconfigured. */
  cronSecret: string | null;
  authHeader: string | null;
  /** Resolved OpenCode Go API key, or null when unconfigured. */
  apiKey: string | null;
  nowMs: number;
  getClient: () => SupabaseAdminLike;
  runRefresh?: (
    client: SupabaseAdminLike,
    nowMs: number,
    deps: { apiKey: string },
  ) => Promise<RefreshOutcome>;
};

export type CollectResult = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * Background-collection HTTP semantics:
 * - CRON_SECRET unconfigured -> 503 (never a silent no-op)
 * - wrong/missing Authorization -> 401
 * - telemetry unconfigured -> 503
 * - API key unconfigured -> 503
 * - provider temporarily unavailable -> 502 (generic; nothing upstream leaks)
 * - storage/unknown failure -> 500
 * - collected -> 200
 */
export async function collectProviderUsage(deps: CollectDeps): Promise<CollectResult> {
  if (!deps.cronSecret) {
    return { status: 503, body: { error: "Background collection is not configured." } };
  }
  if (!isCronAuthorized(deps.cronSecret, deps.authHeader)) {
    return { status: 401, body: { error: "Authentication required." } };
  }
  if (!deps.telemetryConfigured) {
    return { status: 503, body: { error: "Supabase telemetry is not configured." } };
  }
  if (!deps.apiKey) {
    return { status: 503, body: { error: "Live usage is not configured." } };
  }
  const run = deps.runRefresh ?? refreshProviderSnapshot;
  try {
    const outcome = await run(deps.getClient(), deps.nowMs, { apiKey: deps.apiKey });
    if (!outcome.ok) {
      return {
        status: 502,
        body: {
          error: "Live usage is temporarily unavailable.",
          collected: false,
          stored: false,
        },
      };
    }
    return { status: 200, body: { collected: true, stored: outcome.stored } };
  } catch {
    return { status: 500, body: { error: "Collection failed." } };
  }
}
