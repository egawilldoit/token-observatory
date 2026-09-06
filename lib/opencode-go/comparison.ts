/**
 * OpenCode Go V2 comparison engine (MONTHLY ONLY).
 *
 * Single server/domain source of truth for:
 * - active safe ceiling (no interpolation)
 * - freshness (LIVE / RECENT / STALE)
 * - comparison status (RESET_REQUIRED > LIMIT_EXCEEDED > SYNC_STALE >
 *   OVER_PACE > NEAR_PLAN > ON_TRACK)
 * - monthly rollover detection
 *
 * The frontend must NOT duplicate this logic. Pages compute the comparison
 * server-side and pass the result to client components as data.
 *
 * Three separate truths:
 * - Excel workbook = MONTHLY SAFE USAGE CONTRACT (immutable for its cycle)
 * - OpenCode Go API = REAL CURRENT MONTHLY USAGE
 * - This module = COMPARISON / decision layer
 *
 * Formula: safe_headroom = contract_safe_ceiling - provider_monthly_usage
 * in percentage points (pp), not relative percent.
 */

export type OpenCodeGoV2Status =
  | "RESET_REQUIRED"
  | "LIMIT_EXCEEDED"
  | "SYNC_STALE"
  | "OVER_PACE"
  | "NEAR_PLAN"
  | "ON_TRACK";

export type OpenCodeGoFreshness = "LIVE" | "RECENT" | "STALE";

export const V2_LIVE_MS = 5 * 60 * 1000;
export const V2_RECENT_MS = 30 * 60 * 1000;
/** No sufficiently recent provider reading beyond this age. */
export const V2_SYNC_STALE_MS = 30 * 60 * 1000;
/** Headroom (fraction) at or below this is NEAR_PLAN. 0.02 = 2pp. */
export const V2_NEAR_PLAN_HEADROOM = 0.02;
/** Backend refresh cooldown: 45s within the required 30-60s band. */
export const V2_REFRESH_COOLDOWN_MS = 45 * 1000;
/** Page auto-refresh threshold: fetch when the latest snapshot is >=2min old. */
export const V2_AUTO_REFRESH_MS = 2 * 60 * 1000;
/** Snapshot append rule: store when the last observation is >1h old. */
export const V2_SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;

export type V2ContractCheckpoint = {
  day: number;
  date: string;
  checkTime: string;
  timestampMs: number;
  timestamp: string;
  ceiling: number;
};

export type V2Contract = {
  baseline: number;
  trackingStartMs: number;
  resetAtMs: number;
  checkTime: string;
  hardLimit: number;
  safetyReserve: number;
  plannedCeiling: number;
  checkpoints: V2ContractCheckpoint[];
};

export type V2ProviderReading = {
  monthlyFraction: number;
  monthlyStatus: string;
  /** Canonicalized (whole-second) provider reset instant. */
  providerResetsAtMs: number;
  providerResetsAtIso: string;
  observedAtMs: number;
};

export type V2PreviousProvider = {
  /** Canonicalized (whole-second) provider reset instant. */
  resetsAtMs: number;
  monthlyFraction: number;
  /** When the previous reading was observed (for temporal validation). */
  observedAtMs: number;
};

/**
 * Reset-window tolerance. Upstream `resetsAt` carries request-time
 * millisecond jitter (occasionally crossing a second boundary), while a
 * genuine monthly advancement is ~30 days. Differences within the tolerance
 * are the same reset window — never a reset change, rollover, or snapshot.
 */
export const V2_RESET_TOLERANCE_MS = 60_000;
/** Advancement at or above this is a new cycle even without temporal proof. */
const V2_ROLLOVER_MIN_ADVANCEMENT_MS = 24 * 60 * 60 * 1000;
/** Same-window usage collapse kept as a defensive rollover signal. */
const V2_ROLLOVER_SAME_WINDOW_DROP = 0.1;

function isRateLimited(status: string): boolean {
  const normalized = status.trim().toLowerCase().replace(/_/g, "-");
  return (
    normalized === "rate-limited" ||
    normalized.includes("rate-limited") ||
    normalized === "exhausted" ||
    normalized === "limited" ||
    normalized === "exceeded"
  );
}

export function getFreshness(ageMs: number | null): OpenCodeGoFreshness {
  if (ageMs == null) return "STALE";
  if (ageMs < 0) return "LIVE";
  if (ageMs < V2_LIVE_MS) return "LIVE";
  if (ageMs < V2_RECENT_MS) return "RECENT";
  return "STALE";
}

export { formatFreshnessAge } from "./format";

export type ActiveContractState = {
  activeCheckpoint: V2ContractCheckpoint | null;
  activeCeiling: number;
  preFirstCheckpoint: boolean;
  nextCheckpoint: V2ContractCheckpoint | null;
  nextCeiling: number | null;
  msUntilNext: number | null;
};

/**
 * Active safe ceiling: latest contract checkpoint with timestamp <= now.
 * Before the first checkpoint the ceiling is the baseline. No interpolation.
 */
export function getActiveContractState(contract: V2Contract, nowMs: number): ActiveContractState {
  const sorted = [...contract.checkpoints].sort((a, b) => a.timestampMs - b.timestampMs);
  let active: V2ContractCheckpoint | null = null;
  let next: V2ContractCheckpoint | null = null;
  for (const c of sorted) {
    if (c.timestampMs <= nowMs) {
      if (!active || c.timestampMs > active.timestampMs) active = c;
    } else if (!next || c.timestampMs < next.timestampMs) {
      next = c;
    }
  }
  const preFirstCheckpoint = active == null;
  const activeCeiling = active ? active.ceiling : contract.baseline;
  return {
    activeCheckpoint: active,
    activeCeiling,
    preFirstCheckpoint,
    nextCheckpoint: next,
    nextCeiling: next ? next.ceiling : null,
    msUntilNext: next ? Math.max(0, next.timestampMs - nowMs) : null,
  };
}

/**
 * Detect a provider monthly rollover between two observations.
 *
 * Primary evidence is normalized provider reset-window advancement with
 * temporal validation: the canonical reset must have advanced beyond jitter
 * tolerance AND the previous window must have ended (its reset instant is at
 * or before the current observation time), or the advancement itself must be
 * unambiguously a new cycle (>= 1 day). A usage drop is supporting evidence
 * only and is never required: a genuine reset from low usage (e.g. 8% -> 1%)
 * is still a rollover.
 *
 * Millisecond/second jitter around the same instant is never a rollover.
 */
export function detectProviderRollover(
  previous: V2PreviousProvider | null,
  current: { resetsAtMs: number; monthlyFraction: number; observedAtMs: number },
): boolean {
  if (!previous) return false;
  if (
    !Number.isFinite(previous.resetsAtMs) ||
    !Number.isFinite(current.resetsAtMs) ||
    !Number.isFinite(previous.observedAtMs) ||
    !Number.isFinite(current.observedAtMs)
  ) {
    return false;
  }
  const advancement = current.resetsAtMs - previous.resetsAtMs;
  if (advancement <= V2_RESET_TOLERANCE_MS) {
    // Same reset window (jitter): fall through to the defensive same-window
    // collapse check below.
  } else if (
    previous.resetsAtMs <= current.observedAtMs + V2_RESET_TOLERANCE_MS ||
    advancement >= V2_ROLLOVER_MIN_ADVANCEMENT_MS
  ) {
    return true;
  } else {
    // Small advancement before the previous window ended: clock correction,
    // not a new cycle.
    return false;
  }
  // Defensive: same-window usage collapse (no reset movement at all).
  if (
    Math.abs(current.resetsAtMs - previous.resetsAtMs) <= V2_RESET_TOLERANCE_MS &&
    previous.monthlyFraction - current.monthlyFraction > V2_ROLLOVER_SAME_WINDOW_DROP
  ) {
    return true;
  }
  return false;
}

export type V2Comparison = {
  status: OpenCodeGoV2Status;
  /** safe_headroom = activeCeiling - providerFraction (fraction; pp = *100). Null without a provider reading. */
  safeHeadroom: number | null;
  /** provider remaining = 100 - actual (fraction, floored at 0). Null without reading. */
  providerRemaining: number | null;
  providerMonthly: number | null;
  providerStatus: string | null;
  activeCeiling: number;
  activeCheckpoint: V2ContractCheckpoint | null;
  nextCheckpoint: V2ContractCheckpoint | null;
  nextCeiling: number | null;
  msUntilNext: number | null;
  preFirstCheckpoint: boolean;
  freshness: OpenCodeGoFreshness;
  freshnessAgeMs: number | null;
  isRollover: boolean;
  contractResetMs: number;
  providerResetsAtMs: number | null;
};

export function evaluateComparison(args: {
  contract: V2Contract;
  nowMs: number;
  provider: V2ProviderReading | null;
  previousProvider?: V2PreviousProvider | null;
}): V2Comparison {
  const { contract, nowMs, provider } = args;
  const previousProvider = args.previousProvider ?? null;
  const active = getActiveContractState(contract, nowMs);
  const freshnessAgeMs = provider ? Math.max(0, nowMs - provider.observedAtMs) : null;
  const freshness = getFreshness(freshnessAgeMs);

  const base = {
    activeCeiling: active.activeCeiling,
    activeCheckpoint: active.activeCheckpoint,
    nextCheckpoint: active.nextCheckpoint,
    nextCeiling: active.nextCeiling,
    msUntilNext: active.msUntilNext,
    preFirstCheckpoint: active.preFirstCheckpoint,
    freshness,
    freshnessAgeMs,
    contractResetMs: contract.resetAtMs,
    providerResetsAtMs: provider ? provider.providerResetsAtMs : null,
  };

  if (!provider) {
    return {
      ...base,
      status: "SYNC_STALE",
      safeHeadroom: null,
      providerRemaining: null,
      providerMonthly: null,
      providerStatus: null,
      isRollover: false,
    };
  }

  // Non-finite stored readings (corrupt data) are unusable: degrade to
  // SYNC_STALE rather than rendering NaN. An expired contract still reports
  // RESET_REQUIRED, but with null values.
  const usable = Number.isFinite(provider.monthlyFraction) && (provider.monthlyFraction as number) >= 0;
  if (!usable) {
    if (nowMs >= contract.resetAtMs) {
      return {
        ...base,
        status: "RESET_REQUIRED",
        safeHeadroom: null,
        providerRemaining: null,
        providerMonthly: null,
        providerStatus: provider.monthlyStatus,
        isRollover: false,
      };
    }
    return {
      ...base,
      status: "SYNC_STALE",
      safeHeadroom: null,
      providerRemaining: null,
      providerMonthly: null,
      providerStatus: provider.monthlyStatus,
      isRollover: false,
    };
  }

  const isRollover = detectProviderRollover(previousProvider, {
    resetsAtMs: provider.providerResetsAtMs,
    monthlyFraction: provider.monthlyFraction,
    observedAtMs: provider.observedAtMs,
  });

  const providerMonthly = provider.monthlyFraction;
  const providerRemaining = Math.max(0, 1 - providerMonthly);
  const safeHeadroom = active.activeCeiling - providerMonthly;

  // 1. RESET_REQUIRED: the contract cycle ended and no next contract exists,
  // or provider evidence proves a NEW monthly cycle began. A provider reset
  // that merely differs from the contract reset within the same cycle
  // (different anchors/cadences) is NOT a reset — both are displayed
  // separately and compared normally.
  if (nowMs >= contract.resetAtMs) {
    return { ...base, status: "RESET_REQUIRED", safeHeadroom, providerRemaining, providerMonthly, providerStatus: provider.monthlyStatus, isRollover };
  }
  if (isRollover) {
    return { ...base, status: "RESET_REQUIRED", safeHeadroom, providerRemaining, providerMonthly, providerStatus: provider.monthlyStatus, isRollover };
  }

  // 2. LIMIT_EXCEEDED: monthly >= 100% or provider rate-limited.
  if (providerMonthly >= 1 || isRateLimited(provider.monthlyStatus)) {
    return { ...base, status: "LIMIT_EXCEEDED", safeHeadroom, providerRemaining, providerMonthly, providerStatus: provider.monthlyStatus, isRollover };
  }

  // 3. SYNC_STALE: no sufficiently recent provider reading.
  if (freshnessAgeMs == null || freshnessAgeMs > V2_SYNC_STALE_MS) {
    return { ...base, status: "SYNC_STALE", safeHeadroom, providerRemaining, providerMonthly, providerStatus: provider.monthlyStatus, isRollover };
  }

  // Defensive: negative readings are malformed upstream data; never crash.
  // Clamp the comparison so the UI stays meaningful.
  const effective = Number.isFinite(providerMonthly) && providerMonthly >= 0 ? providerMonthly : 0;
  const headroom = active.activeCeiling - effective;

  // 4. OVER_PACE: actual > active safe ceiling.
  if (effective > active.activeCeiling) {
    return { ...base, status: "OVER_PACE", safeHeadroom: headroom, providerRemaining, providerMonthly, providerStatus: provider.monthlyStatus, isRollover };
  }

  // 5. NEAR_PLAN: headroom in [0, 2pp] inclusive (with epsilon for binary fp).
  if (headroom >= -1e-12 && headroom <= V2_NEAR_PLAN_HEADROOM + 1e-9) {
    return { ...base, status: "NEAR_PLAN", safeHeadroom: headroom, providerRemaining, providerMonthly, providerStatus: provider.monthlyStatus, isRollover };
  }

  // 6. ON_TRACK: headroom > 2pp.
  return { ...base, status: "ON_TRACK", safeHeadroom: headroom, providerRemaining, providerMonthly, providerStatus: provider.monthlyStatus, isRollover };
}

/** Append-only snapshot rule: store when % / status / reset changed or >1h old.
 * Reset comparison uses the jitter tolerance so request-time millisecond
 * noise never creates a snapshot. */
export function shouldStoreProviderSnapshot(args: {
  previous: { monthlyFraction: number; monthlyStatus: string; providerResetsAtMs: number; observedAtMs: number } | null;
  next: { monthlyFraction: number; monthlyStatus: string; providerResetsAtMs: number };
  nowMs: number;
}): boolean {
  const { previous, next, nowMs } = args;
  if (!previous) return true;
  if (next.monthlyFraction !== previous.monthlyFraction) return true;
  if (next.monthlyStatus !== previous.monthlyStatus) return true;
  if (Math.abs(next.providerResetsAtMs - previous.providerResetsAtMs) > V2_RESET_TOLERANCE_MS) return true;
  if (nowMs - previous.observedAtMs > V2_SNAPSHOT_MAX_AGE_MS) return true;
  return false;
}

export function shouldAutoRefresh(nowMs: number, latestObservedAtMs: number | null): boolean {
  if (latestObservedAtMs == null) return true;
  return nowMs - latestObservedAtMs >= V2_AUTO_REFRESH_MS;
}

export function isRefreshCooldown(nowMs: number, latestObservedAtMs: number | null): boolean {
  if (latestObservedAtMs == null) return false;
  return nowMs - latestObservedAtMs < V2_REFRESH_COOLDOWN_MS;
}
