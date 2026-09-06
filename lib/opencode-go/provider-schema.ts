/**
 * OpenCode Go provider schema + transport (V2, MONTHLY ONLY).
 *
 * Runtime-independent helpers: no server-only import, no environment access.
 * Safe to unit-test. The secret-holding entrypoint lives in `provider.ts`
 * (real `import "server-only"` boundary); this module only receives an
 * already-resolved key as a parameter and never logs or returns it.
 */

export const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage" as const;
export const OPENCODE_GO_PROVIDER_TIMEOUT_MS = 10_000;

export type OpenCodeGoProviderErrorCode =
  | "not_configured"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "upstream"
  | "timeout"
  | "malformed"
  | "network";

export class OpenCodeGoProviderError extends Error {
  code: OpenCodeGoProviderErrorCode;
  status?: number;
  constructor(code: OpenCodeGoProviderErrorCode, message: string, status?: number) {
    super(`${code}: ${message}`);
    this.name = "OpenCodeGoProviderError";
    this.code = code;
    this.status = status;
  }
}

/**
 * OpenCode `resetsAt` carries request-time millisecond jitter
 * (e.g. 11:13:41.824Z vs 11:13:41.569Z for the same window). Canonicalize to
 * whole-second precision so jitter can never read as a reset change.
 */
export function canonicalizeProviderResetMs(ms: number): number {
  return Math.floor(ms / 1000) * 1000;
}

/**
 * Tolerance for comparing provider reset instants. Jitter is milliseconds to
 * seconds; a genuine monthly advancement is ~30 days. Anything within the
 * tolerance is the same reset window.
 */
export const PROVIDER_RESET_TOLERANCE_MS = 60_000;

export function sameProviderResetWindow(aMs: number, bMs: number): boolean {
  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return false;
  return Math.abs(canonicalizeProviderResetMs(aMs) - canonicalizeProviderResetMs(bMs)) <= PROVIDER_RESET_TOLERANCE_MS;
}

export type OpenCodeGoProviderMonthly = {
  /** Normalized fraction: 0.19 = 19%. Derived as `percent / 100`. */
  monthlyFraction: number;
  /** Raw upstream percent (0-100 scale, may exceed 100 defensively). */
  monthlyPercentRaw: number;
  /** Upstream monthly status (e.g. "ok" | "rate-limited"). Preserved verbatim. */
  monthlyStatus: string;
  /**
   * Provider monthly reset instant, canonicalized to whole seconds
   * (see `canonicalizeProviderResetMs`).
   */
  providerResetsAtMs: number;
  /** Canonical reset ISO string (whole seconds, `.000Z`). */
  providerResetsAtIso: string;
};

export type OpenCodeGoProviderFetchResult = {
  monthly: OpenCodeGoProviderMonthly;
  fetchDurationMs: number;
  /** Transport completion time. See observed/fetched semantics in the spec. */
  fetchedAtMs: number;
};

export function isProviderRateLimitedStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase().replace(/_/g, "-");
  return (
    normalized === "rate-limited" ||
    normalized.includes("rate-limited") ||
    normalized === "exhausted" ||
    normalized === "limited" ||
    normalized === "exceeded"
  );
}

/**
 * Runtime-validate an unknown JSON payload into a monthly observation.
 * Throws OpenCodeGoProviderError(malformed) on any contract violation.
 * Never includes secrets in the message. Rolling/weekly windows are ignored.
 */
export function parseProviderMonthlyPayload(payload: unknown): OpenCodeGoProviderMonthly {
  if (typeof payload !== "object" || payload === null) {
    throw new OpenCodeGoProviderError("malformed", "provider response is not an object");
  }
  const root = payload as Record<string, unknown>;
  const usage = root.usage;
  if (typeof usage !== "object" || usage === null) {
    throw new OpenCodeGoProviderError("malformed", "provider response is missing usage.monthly");
  }
  const monthly = (usage as Record<string, unknown>).monthly;
  if (typeof monthly !== "object" || monthly === null) {
    throw new OpenCodeGoProviderError("malformed", "provider response is missing usage.monthly");
  }
  const m = monthly as Record<string, unknown>;

  const percent = m.percent;
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0) {
    throw new OpenCodeGoProviderError("malformed", "provider monthly percent is malformed");
  }
  // Upstream clamps 0-100, but the comparison engine must handle >100
  // defensively (LIMIT_EXCEEDED). Accept a generous upper bound and reject
  // only absurd values that indicate a contract break.
  if (percent > 1000) {
    throw new OpenCodeGoProviderError("malformed", "provider monthly percent is out of range");
  }

  const status = m.status;
  if (typeof status !== "string" || status.trim() === "") {
    throw new OpenCodeGoProviderError("malformed", "provider monthly status is malformed");
  }

  const resetsAt = m.resetsAt;
  if (typeof resetsAt !== "string" || resetsAt.trim() === "") {
    throw new OpenCodeGoProviderError("malformed", "provider monthly resetsAt is malformed");
  }
  const parsedMs = Date.parse(resetsAt);
  if (!Number.isFinite(parsedMs)) {
    throw new OpenCodeGoProviderError("malformed", "provider monthly resetsAt is not a valid timestamp");
  }
  const resetsAtMs = canonicalizeProviderResetMs(parsedMs);

  return {
    monthlyFraction: percent / 100,
    monthlyPercentRaw: percent,
    monthlyStatus: status,
    providerResetsAtMs: resetsAtMs,
    providerResetsAtIso: new Date(resetsAtMs).toISOString(),
  };
}

/** Map an HTTP status to a provider error (pure; no secrets involved). */
export function providerHttpError(status: number): OpenCodeGoProviderError {
  if (status === 401) {
    return new OpenCodeGoProviderError("unauthorized", "OpenCode Go API key was rejected", 401);
  }
  if (status === 403) {
    return new OpenCodeGoProviderError("forbidden", "OpenCode Go subscription is not available for this key", 403);
  }
  if (status === 429) {
    return new OpenCodeGoProviderError("rate_limited", "OpenCode usage endpoint is rate limited", 429);
  }
  if (status >= 500 && status <= 599) {
    return new OpenCodeGoProviderError("upstream", "OpenCode usage endpoint is temporarily unavailable", status);
  }
  return new OpenCodeGoProviderError("upstream", "OpenCode usage endpoint returned an unexpected status", status);
}

type FetchFn = typeof fetch;

export async function fetchProviderMonthly(args: {
  apiKey: string;
  timeoutMs?: number;
  fetchFn?: FetchFn;
  url?: string;
}): Promise<OpenCodeGoProviderFetchResult> {
  const { apiKey, timeoutMs = OPENCODE_GO_PROVIDER_TIMEOUT_MS, fetchFn = fetch, url = OPENCODE_GO_USAGE_URL } = args;
  if (!apiKey || apiKey.trim() === "") {
    throw new OpenCodeGoProviderError("not_configured", "OpenCode Go API key is not configured");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new OpenCodeGoProviderError("timeout", "OpenCode usage request timed out");
    }
    throw new OpenCodeGoProviderError("network", "OpenCode usage request failed");
  } finally {
    clearTimeout(timer);
  }

  const fetchDurationMs = Date.now() - startedAt;

  if (!response.ok) {
    throw providerHttpError(response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new OpenCodeGoProviderError("malformed", "OpenCode usage response was not valid JSON");
  }

  const monthly = parseProviderMonthlyPayload(payload);
  return { monthly, fetchDurationMs, fetchedAtMs: Date.now() };
}

/**
 * Sanitized user-facing message for a provider failure. Never includes the
 * API key, upstream bodies, status internals, or raw errors.
 */
export function providerErrorMessage(error: unknown): string {
  if (error instanceof OpenCodeGoProviderError) {
    switch (error.code) {
      case "not_configured":
        return "Live usage is not configured yet.";
      case "unauthorized":
      case "forbidden":
        return "Live usage is unavailable. Check the OpenCode Go subscription.";
      case "rate_limited":
        return "Live usage is temporarily rate limited. Showing the last synced reading.";
      case "timeout":
      case "network":
      case "upstream":
        return "Live usage is temporarily unavailable. Showing the last synced reading.";
      case "malformed":
        return "Live usage returned an unexpected response. Showing the last synced reading.";
    }
  }
  return "Live usage is temporarily unavailable. Showing the last synced reading.";
}
