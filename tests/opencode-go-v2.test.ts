import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import {
  OPENCODE_GO_USAGE_URL,
  OpenCodeGoProviderError,
  PROVIDER_RESET_TOLERANCE_MS,
  canonicalizeProviderResetMs,
  fetchProviderMonthly,
  isProviderRateLimitedStatus,
  parseProviderMonthlyPayload,
  providerErrorMessage,
  providerHttpError,
  sameProviderResetWindow,
} from "../lib/opencode-go/provider-schema.js";
import {
  V2_AUTO_REFRESH_MS,
  V2_RECENT_MS,
  V2_LIVE_MS,
  V2_REFRESH_COOLDOWN_MS,
  V2_RESET_TOLERANCE_MS,
  V2_SNAPSHOT_MAX_AGE_MS,
  V2_SYNC_STALE_MS,
  detectProviderRollover,
  evaluateComparison,
  getActiveContractState,
  getFreshness,
  isRefreshCooldown,
  shouldAutoRefresh,
  shouldStoreProviderSnapshot,
  type V2Contract,
  type V2PreviousProvider,
} from "../lib/opencode-go/comparison.js";
import { buildV2CheckpointRows, buildV2View } from "../lib/opencode-go/v2-view.js";
import { refreshProviderSnapshot } from "../lib/opencode-go/refresh.js";
import { formatWholePercent } from "../lib/opencode-go/format.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monthlyPayload(overrides: Record<string, unknown> = {}) {
  return {
    usage: {
      rolling: { status: "ok", percent: 4, resetsAt: "2026-09-06T10:00:00.000Z" },
      weekly: { status: "ok", percent: 3, resetsAt: "2026-09-07T00:00:00.000Z" },
      monthly: {
        status: "ok",
        percent: 19,
        resetsAt: "2026-10-01T00:00:00.000Z",
        ...overrides,
      },
    },
  };
}

function contractFixture(): V2Contract {
  const day = 86400000;
  const t0 = Date.UTC(2026, 7, 30, 21, 29, 0);
  return {
    baseline: 0.048,
    trackingStartMs: t0,
    resetAtMs: t0 + 30 * day,
    checkTime: "12:00",
    hardLimit: 1.0,
    safetyReserve: 0,
    plannedCeiling: 1.0,
    checkpoints: [
      { day: 1, date: "2026-08-31", checkTime: "12:00", timestampMs: t0 + 1 * day, timestamp: new Date(t0 + 1 * day).toISOString(), ceiling: 0.08 },
      { day: 2, date: "2026-09-01", checkTime: "12:00", timestampMs: t0 + 2 * day, timestamp: new Date(t0 + 2 * day).toISOString(), ceiling: 0.12 },
      { day: 3, date: "2026-09-05", checkTime: "12:00", timestampMs: t0 + 6 * day, timestamp: new Date(t0 + 6 * day).toISOString(), ceiling: 0.2273 },
    ],
  };
}

function reading(overrides: Record<string, number | string> = {}) {
  return {
    monthlyFraction: 0.19,
    monthlyStatus: "ok",
    providerResetsAtMs: Date.parse("2026-09-29T21:29:00.000Z"),
    providerResetsAtIso: "2026-09-29T21:29:00.000Z",
    observedAtMs: Date.parse("2026-09-05T14:00:00.000Z"),
    ...overrides,
  } as {
    monthlyFraction: number;
    monthlyStatus: string;
    providerResetsAtMs: number;
    providerResetsAtIso: string;
    observedAtMs: number;
  };
}

function prev(overrides: Partial<V2PreviousProvider> & { resetsAtMs: number }): V2PreviousProvider {
  return {
    monthlyFraction: 0.19,
    observedAtMs: Date.parse("2026-09-05T13:00:00.000Z"),
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Window-explicit contract for history-assignment tests (UTC noon checkpoints). */
function windowContract() {
  const cp1 = Date.UTC(2026, 8, 5, 12, 0, 0);
  const cp2 = Date.UTC(2026, 8, 6, 12, 0, 0);
  const contract: V2Contract = {
    baseline: 0.05,
    trackingStartMs: Date.UTC(2026, 8, 4, 0, 0, 0),
    resetAtMs: Date.UTC(2026, 8, 10, 0, 0, 0),
    checkTime: "12:00",
    hardLimit: 1,
    safetyReserve: 0,
    plannedCeiling: 1,
    checkpoints: [
      { day: 1, date: "2026-09-05", checkTime: "12:00", timestampMs: cp1, timestamp: new Date(cp1).toISOString(), ceiling: 0.2 },
      { day: 2, date: "2026-09-06", checkTime: "12:00", timestampMs: cp2, timestamp: new Date(cp2).toISOString(), ceiling: 0.25 },
    ],
  };
  return { contract, cp1, cp2 };
}

function snapshotRow(observedMs: number, fraction: number, resetsAtMs: number) {
  const observed = new Date(observedMs).toISOString();
  return {
    id: `s-${observedMs}`,
    observed_at: observed,
    fetched_at: observed,
    monthly_percent: fraction,
    monthly_status: "ok",
    provider_resets_at: new Date(resetsAtMs).toISOString(),
    source: "opencode_api",
    fetch_duration_ms: 50,
    created_at: observed,
  };
}

// ---------------------------------------------------------------------------
// Provider schema / errors / timeouts (runtime-independent, unit-tested)
// ---------------------------------------------------------------------------

describe("v2 provider schema", () => {
  it("holds the real server-only boundary in provider.ts, pure logic in schema", async () => {
    assert.equal(OPENCODE_GO_USAGE_URL, "https://opencode.ai/zen/go/v1/usage");
    const server = await readFile(new URL("../lib/opencode-go/provider.ts", import.meta.url), "utf8");
    assert.match(server, /import "server-only"/);
    assert.match(server, /getOpenCodeGoApiKey/);
    assert.match(server, /OPENCODE_GO_API_KEY/);
    assert.match(server, /fetchConfiguredProviderMonthly/);
    const schema = await readFile(new URL("../lib/opencode-go/provider-schema.ts", import.meta.url), "utf8");
    assert.doesNotMatch(schema, /^import "server-only";/m);
    assert.doesNotMatch(schema, /process\.env/);
    assert.doesNotMatch(schema, /localStorage|sessionStorage/);
  });

  it("parses monthly percent/status/resetsAt and normalizes to a fraction", () => {
    const m = parseProviderMonthlyPayload(monthlyPayload());
    assert.equal(m.monthlyPercentRaw, 19);
    assert.equal(m.monthlyFraction, 0.19);
    assert.equal(m.monthlyStatus, "ok");
    assert.equal(m.providerResetsAtIso, "2026-10-01T00:00:00.000Z");
  });

  it("canonicalizes resetsAt to whole seconds (request-time jitter)", () => {
    const a = parseProviderMonthlyPayload(monthlyPayload({ resetsAt: "2026-09-13T11:13:41.824Z" }));
    const b = parseProviderMonthlyPayload(monthlyPayload({ resetsAt: "2026-09-13T11:13:41.569Z" }));
    assert.equal(a.providerResetsAtMs, b.providerResetsAtMs);
    assert.equal(a.providerResetsAtMs, Date.parse("2026-09-13T11:13:41.000Z"));
    assert.match(a.providerResetsAtIso, /\.000Z$/);
    assert.equal(canonicalizeProviderResetMs(Date.parse("2026-09-13T11:13:41.999Z")), Date.parse("2026-09-13T11:13:41.000Z"));
  });

  it("treats instants within tolerance as the same reset window", () => {
    assert.equal(PROVIDER_RESET_TOLERANCE_MS, 60_000);
    assert.equal(V2_RESET_TOLERANCE_MS, 60_000);
    const base = Date.parse("2026-09-13T11:13:41.000Z");
    assert.equal(sameProviderResetWindow(base + 824, base + 569), true);
    assert.equal(sameProviderResetWindow(base, base + 59_000), true);
    assert.equal(sameProviderResetWindow(base, base + 61_000), false);
    assert.equal(sameProviderResetWindow(base, base + 30 * 86400000), false);
  });

  it("ignores rolling and weekly windows (monthly only)", () => {
    const m = parseProviderMonthlyPayload({
      usage: { monthly: { status: "ok", percent: 19, resetsAt: "2026-10-01T00:00:00.000Z" } },
    });
    assert.equal(m.monthlyFraction, 0.19);
    const withNoise = parseProviderMonthlyPayload({
      usage: {
        rolling: { status: "rate-limited", percent: 99, resetsAt: "2026-09-06T00:00:00.000Z" },
        weekly: { status: "rate-limited", percent: 99, resetsAt: "2026-09-07T00:00:00.000Z" },
        monthly: { status: "ok", percent: 19, resetsAt: "2026-10-01T00:00:00.000Z" },
      },
    });
    assert.equal(withNoise.monthlyFraction, 0.19);
    assert.equal(withNoise.monthlyStatus, "ok");
  });

  it("rejects malformed contracts", () => {
    assert.throws(() => parseProviderMonthlyPayload(null), /malformed/);
    assert.throws(() => parseProviderMonthlyPayload({}), /malformed/);
    assert.throws(() => parseProviderMonthlyPayload({ usage: {} }), /malformed/);
    assert.throws(() => parseProviderMonthlyPayload({ usage: { monthly: null } }), /malformed/);
    assert.throws(() => parseProviderMonthlyPayload(monthlyPayload({ percent: "19" })), /malformed/);
    assert.throws(() => parseProviderMonthlyPayload(monthlyPayload({ percent: Number.NaN })), /malformed/);
    assert.throws(() => parseProviderMonthlyPayload(monthlyPayload({ percent: -1 })), /malformed/);
    assert.throws(() => parseProviderMonthlyPayload(monthlyPayload({ percent: 1001 })), /malformed/);
    assert.throws(() => parseProviderMonthlyPayload(monthlyPayload({ status: "" })), /malformed/);
    assert.throws(() => parseProviderMonthlyPayload(monthlyPayload({ status: 42 })), /malformed/);
    assert.throws(() => parseProviderMonthlyPayload(monthlyPayload({ resetsAt: "not-a-date" })), /malformed/);
    assert.throws(() => parseProviderMonthlyPayload(monthlyPayload({ resetsAt: "" })), /malformed/);
  });

  it("detects rate-limited statuses without case/format sensitivity", () => {
    assert.equal(isProviderRateLimitedStatus("rate-limited"), true);
    assert.equal(isProviderRateLimitedStatus("rate_limited"), true);
    assert.equal(isProviderRateLimitedStatus("RATE-LIMITED"), true);
    assert.equal(isProviderRateLimitedStatus("ok"), false);
    assert.equal(isProviderRateLimitedStatus("active"), false);
  });

  it("maps HTTP failures to explicit codes", () => {
    assert.equal(providerHttpError(401).code, "unauthorized");
    assert.equal(providerHttpError(403).code, "forbidden");
    assert.equal(providerHttpError(429).code, "rate_limited");
    assert.equal(providerHttpError(500).code, "upstream");
    assert.equal(providerHttpError(503).code, "upstream");
    assert.equal(providerHttpError(418).code, "upstream");
  });

  it("maps HTTP failures end to end without leaking the secret", async () => {
    const key = "test-key-123";
    async function codeFor(status: number) {
      try {
        await fetchProviderMonthly({ apiKey: key, fetchFn: (async () => jsonResponse({}, status)) as typeof fetch });
        assert.fail("should throw");
      } catch (error) {
        assert.doesNotMatch(String(error), /test-key-123/);
        return (error as OpenCodeGoProviderError).code;
      }
    }
    assert.equal(await codeFor(401), "unauthorized");
    assert.equal(await codeFor(403), "forbidden");
    assert.equal(await codeFor(429), "rate_limited");
    assert.equal(await codeFor(500), "upstream");
    assert.equal(await codeFor(503), "upstream");
    assert.equal(await codeFor(418), "upstream");
  });

  it("maps malformed JSON to a malformed error", async () => {
    try {
      await fetchProviderMonthly({
        apiKey: "k",
        fetchFn: (async () => new Response("not json {{{", { status: 200 })) as typeof fetch,
      });
      assert.fail("should throw");
    } catch (error) {
      assert.equal((error as OpenCodeGoProviderError).code, "malformed");
    }
  });

  it("maps aborts to timeout and never leaks the secret", async () => {
    const secret = "sk-live-secret-xyz-999";
    const aborting = (async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    }) as typeof fetch;
    try {
      await fetchProviderMonthly({ apiKey: secret, fetchFn: aborting });
      assert.fail("should throw");
    } catch (error) {
      assert.equal((error as OpenCodeGoProviderError).code, "timeout");
      assert.doesNotMatch(String(error), /sk-live-secret/);
    }
    try {
      await fetchProviderMonthly({ apiKey: "" });
      assert.fail("should throw");
    } catch (error) {
      assert.equal((error as OpenCodeGoProviderError).code, "not_configured");
    }
    const networkFail = (async () => {
      throw new Error("socket hangup");
    }) as typeof fetch;
    try {
      await fetchProviderMonthly({ apiKey: secret, fetchFn: networkFail });
      assert.fail("should throw");
    } catch (error) {
      assert.equal((error as OpenCodeGoProviderError).code, "network");
      assert.doesNotMatch(String(error), /sk-live-secret/);
    }
  });

  it("measures fetch duration and returns monthly-only data", async () => {
    const result = await fetchProviderMonthly({
      apiKey: "k",
      fetchFn: (async () => jsonResponse(monthlyPayload())) as typeof fetch,
    });
    assert.equal(result.monthly.monthlyFraction, 0.19);
    assert.ok(result.fetchDurationMs >= 0);
    assert.ok(Number.isFinite(result.fetchedAtMs));
  });

  it("sanitizes user-facing messages (no secret, no raw errors)", () => {
    const secret = "sk-live-secret-xyz-999";
    for (const code of ["unauthorized", "forbidden", "rate_limited", "upstream", "timeout", "malformed", "network", "not_configured"] as const) {
      const message = providerErrorMessage(new OpenCodeGoProviderError(code, `boom ${secret}`));
      assert.doesNotMatch(message, /sk-live-secret/);
      assert.doesNotMatch(message, /boom/);
    }
    assert.doesNotMatch(providerErrorMessage(new Error(`raw ${secret}`)), /sk-live-secret/);
  });
});

// ---------------------------------------------------------------------------
// Comparison: actual vs ceiling, boundaries, defensive cases
// ---------------------------------------------------------------------------

describe("v2 comparison: actual vs safe ceiling", () => {
  it("computes headroom in percentage points (example: 22.73 - 19.00 = +3.73pp)", () => {
    const contract = contractFixture();
    const nowMs = contract.checkpoints[2]!.timestampMs + 3600000;
    const result = evaluateComparison({
      contract,
      nowMs,
      provider: reading({ monthlyFraction: 0.19, observedAtMs: nowMs - 60000 }),
    });
    assert.equal(result.status, "ON_TRACK");
    assert.ok(result.safeHeadroom != null && Math.abs(result.safeHeadroom - 0.0373) < 1e-9);
    // Absolute pp, not relative percent.
    assert.ok(Math.abs(result.safeHeadroom - (0.2273 - 0.19)) < 1e-12);
  });

  it("treats actual == ceiling as NEAR_PLAN (0 inclusive)", () => {
    const contract = contractFixture();
    const nowMs = contract.checkpoints[2]!.timestampMs + 1000;
    const result = evaluateComparison({
      contract,
      nowMs,
      provider: reading({ monthlyFraction: 0.2273, observedAtMs: nowMs - 1000 }),
    });
    assert.equal(result.status, "NEAR_PLAN");
    assert.equal(result.safeHeadroom, 0);
  });

  it("treats actual > ceiling as OVER_PACE", () => {
    const contract = contractFixture();
    const nowMs = contract.checkpoints[2]!.timestampMs + 1000;
    const result = evaluateComparison({
      contract,
      nowMs,
      provider: reading({ monthlyFraction: 0.25, observedAtMs: nowMs - 1000 }),
    });
    assert.equal(result.status, "OVER_PACE");
    assert.ok((result.safeHeadroom as number) < 0);
  });

  it("enforces the 2pp boundary inclusively", () => {
    const base: V2Contract = {
      baseline: 0,
      trackingStartMs: 0,
      resetAtMs: 100 * 86400000,
      checkTime: "12:00",
      hardLimit: 1,
      safetyReserve: 0,
      plannedCeiling: 1,
      checkpoints: [
        { day: 1, date: "2026-09-05", checkTime: "12:00", timestampMs: 10 * 86400000, timestamp: new Date(10 * 86400000).toISOString(), ceiling: 0.5 },
      ],
    };
    const nowMs = 10 * 86400000 + 1000;
    const at = (fraction: number) =>
      evaluateComparison({ contract: base, nowMs, provider: reading({ monthlyFraction: fraction, observedAtMs: nowMs - 1000, providerResetsAtMs: 90 * 86400000, providerResetsAtIso: new Date(90 * 86400000).toISOString() }) });
    assert.equal(at(0.48).status, "NEAR_PLAN");
    assert.equal(at(0.5).status, "NEAR_PLAN");
    assert.equal(at(0.4799).status, "ON_TRACK");
    assert.equal(at(0.5001).status, "OVER_PACE");
  });

  it("handles 0 / 100 / >100 defensively", () => {
    const contract = contractFixture();
    const nowMs = contract.checkpoints[2]!.timestampMs + 1000;
    const zero = evaluateComparison({ contract, nowMs, provider: reading({ monthlyFraction: 0, observedAtMs: nowMs - 1000 }) });
    assert.equal(zero.status, "ON_TRACK");
    assert.equal(zero.providerRemaining, 1);
    const hundred = evaluateComparison({ contract, nowMs, provider: reading({ monthlyFraction: 1, observedAtMs: nowMs - 1000 }) });
    assert.equal(hundred.status, "LIMIT_EXCEEDED");
    assert.equal(hundred.providerRemaining, 0);
    const over = evaluateComparison({ contract, nowMs, provider: reading({ monthlyFraction: 1.2, observedAtMs: nowMs - 1000 }) });
    assert.equal(over.status, "LIMIT_EXCEEDED");
    assert.equal(over.providerRemaining, 0);
  });

  it("treats provider rate-limited as LIMIT_EXCEEDED even at low usage", () => {
    const contract = contractFixture();
    const nowMs = contract.checkpoints[2]!.timestampMs + 1000;
    for (const status of ["rate-limited", "rate_limited", "RATE-LIMITED"]) {
      const result = evaluateComparison({
        contract,
        nowMs,
        provider: reading({ monthlyFraction: 0.1, monthlyStatus: status, observedAtMs: nowMs - 1000 }),
      });
      assert.equal(result.status, "LIMIT_EXCEEDED");
    }
  });

  it("degrades corrupt stored readings to SYNC_STALE (never NaN)", () => {
    const contract = contractFixture();
    const nowMs = contract.checkpoints[2]!.timestampMs + 1000;
    const corrupt = evaluateComparison({
      contract,
      nowMs,
      provider: reading({ monthlyFraction: Number.NaN, observedAtMs: nowMs - 1000 }),
    });
    assert.equal(corrupt.status, "SYNC_STALE");
    assert.equal(corrupt.safeHeadroom, null);
    assert.equal(corrupt.providerMonthly, null);
    const expiredCorrupt = evaluateComparison({
      contract,
      nowMs: contract.resetAtMs,
      provider: reading({ monthlyFraction: Number.NaN, observedAtMs: contract.resetAtMs - 1000 }),
    });
    assert.equal(expiredCorrupt.status, "RESET_REQUIRED");
    assert.equal(expiredCorrupt.safeHeadroom, null);
  });

  it("does not mutate the contract input", () => {
    const contract = contractFixture();
    const frozen = JSON.parse(JSON.stringify(contract)) as V2Contract;
    Object.freeze(contract);
    Object.freeze(contract.checkpoints);
    const nowMs = contract.checkpoints[0]!.timestampMs + 1000;
    evaluateComparison({ contract, nowMs, provider: reading({ observedAtMs: nowMs - 1000 }) });
    assert.deepEqual(contract, frozen);
  });
});

// ---------------------------------------------------------------------------
// Active ceiling: before / exactly / after, no interpolation
// ---------------------------------------------------------------------------

describe("v2 active safe ceiling", () => {
  function threePoint(): { contract: V2Contract; t1: number; t2: number } {
    const t1 = 1000000;
    const t2 = 2000000;
    return {
      t1,
      t2,
      contract: {
        baseline: 0.05,
        trackingStartMs: 0,
        resetAtMs: 9000000,
        checkTime: "12:00",
        hardLimit: 1,
        safetyReserve: 0,
        plannedCeiling: 1,
        checkpoints: [
          { day: 1, date: "2026-09-01", checkTime: "12:00", timestampMs: t1, timestamp: new Date(t1).toISOString(), ceiling: 0.1 },
          { day: 2, date: "2026-09-02", checkTime: "12:00", timestampMs: t2, timestamp: new Date(t2).toISOString(), ceiling: 0.2 },
        ],
      },
    };
  }

  it("uses the baseline before the first checkpoint", () => {
    const { contract, t1 } = threePoint();
    const state = getActiveContractState(contract, t1 - 1);
    assert.equal(state.activeCeiling, 0.05);
    assert.equal(state.activeCheckpoint, null);
    assert.equal(state.preFirstCheckpoint, true);
    assert.equal(state.nextCheckpoint?.timestampMs, t1);
    assert.equal(state.nextCeiling, 0.1);
  });

  it("activates exactly at the checkpoint timestamp (<= now)", () => {
    const { contract, t1 } = threePoint();
    const state = getActiveContractState(contract, t1);
    assert.equal(state.activeCeiling, 0.1);
    assert.equal(state.preFirstCheckpoint, false);
  });

  it("holds the step with no interpolation between checkpoints", () => {
    const { contract, t1, t2 } = threePoint();
    const mid = t1 + Math.floor((t2 - t1) / 2);
    const state = getActiveContractState(contract, mid);
    assert.equal(state.activeCeiling, 0.1);
    assert.notEqual(state.activeCeiling, 0.15);
    const atSecond = getActiveContractState(contract, t2);
    assert.equal(atSecond.activeCeiling, 0.2);
  });

  it("exposes next ceiling and time until next", () => {
    const { contract, t1, t2 } = threePoint();
    const state = getActiveContractState(contract, t1 + 10);
    assert.equal(state.nextCheckpoint?.timestampMs, t2);
    assert.equal(state.nextCeiling, 0.2);
    assert.equal(state.msUntilNext, t2 - (t1 + 10));
    const last = getActiveContractState(contract, t2 + 10);
    assert.equal(last.nextCheckpoint, null);
    assert.equal(last.nextCeiling, null);
    assert.equal(last.msUntilNext, null);
  });
});

// ---------------------------------------------------------------------------
// Freshness + SYNC_STALE independence
// ---------------------------------------------------------------------------

describe("v2 freshness", () => {
  it("classifies LIVE <5m, RECENT 5-30m, STALE >30m", () => {
    assert.equal(getFreshness(null), "STALE");
    assert.equal(getFreshness(0), "LIVE");
    assert.equal(getFreshness(4 * 60 * 1000 + 59000), "LIVE");
    assert.equal(getFreshness(5 * 60 * 1000), "RECENT");
    assert.equal(getFreshness(29 * 60 * 1000), "RECENT");
    assert.equal(getFreshness(30 * 60 * 1000), "STALE");
    assert.equal(getFreshness(60 * 60 * 1000), "STALE");
    assert.equal(V2_LIVE_MS, 5 * 60 * 1000);
    assert.equal(V2_RECENT_MS, 30 * 60 * 1000);
    assert.equal(V2_SYNC_STALE_MS, 30 * 60 * 1000);
  });

  it("keeps freshness and comparison status independent", () => {
    const contract = contractFixture();
    const nowMs = contract.checkpoints[2]!.timestampMs + 1000;
    const liveOver = evaluateComparison({
      contract,
      nowMs,
      provider: reading({ monthlyFraction: 0.5, observedAtMs: nowMs - 60000 }),
    });
    assert.equal(liveOver.freshness, "LIVE");
    assert.equal(liveOver.status, "OVER_PACE");
    const recentOnTrack = evaluateComparison({
      contract,
      nowMs,
      provider: reading({ monthlyFraction: 0.1, observedAtMs: nowMs - 10 * 60 * 1000 }),
    });
    assert.equal(recentOnTrack.freshness, "RECENT");
    assert.equal(recentOnTrack.status, "ON_TRACK");
  });

  it("reports SYNC_STALE without a reading and when stale, preserving values", () => {
    const contract = contractFixture();
    const nowMs = contract.checkpoints[2]!.timestampMs + 1000;
    const none = evaluateComparison({ contract, nowMs, provider: null });
    assert.equal(none.status, "SYNC_STALE");
    assert.equal(none.safeHeadroom, null);
    assert.equal(none.freshness, "STALE");
    const stale = evaluateComparison({
      contract,
      nowMs,
      provider: reading({ monthlyFraction: 0.1, observedAtMs: nowMs - 31 * 60 * 1000 }),
    });
    assert.equal(stale.status, "SYNC_STALE");
    assert.equal(stale.freshness, "STALE");
    // Values are still exposed for display even when stale.
    assert.ok(stale.safeHeadroom != null);
    assert.equal(stale.providerMonthly, 0.1);
  });
});

// ---------------------------------------------------------------------------
// Status precedence
// ---------------------------------------------------------------------------

describe("v2 status precedence", () => {
  it("orders RESET_REQUIRED > LIMIT_EXCEEDED > SYNC_STALE > OVER_PACE > NEAR_PLAN > ON_TRACK", () => {
    const contract = contractFixture();
    const activeMs = contract.checkpoints[2]!.timestampMs + 1000;
    // RESET beats LIMIT.
    const resetBeatsLimit = evaluateComparison({
      contract,
      nowMs: contract.resetAtMs,
      provider: reading({ monthlyFraction: 1.5, observedAtMs: contract.resetAtMs - 1000 }),
    });
    assert.equal(resetBeatsLimit.status, "RESET_REQUIRED");
    // LIMIT beats STALE.
    const limitBeatsStale = evaluateComparison({
      contract,
      nowMs: activeMs,
      provider: reading({ monthlyFraction: 1.2, observedAtMs: activeMs - 60 * 60 * 1000 }),
    });
    assert.equal(limitBeatsStale.status, "LIMIT_EXCEEDED");
    // STALE beats OVER_PACE.
    const staleBeatsOver = evaluateComparison({
      contract,
      nowMs: activeMs,
      provider: reading({ monthlyFraction: 0.9, observedAtMs: activeMs - 60 * 60 * 1000 }),
    });
    assert.equal(staleBeatsOver.status, "SYNC_STALE");
  });
});

// ---------------------------------------------------------------------------
// Rollover, jitter, and reset distinction
// ---------------------------------------------------------------------------

describe("v2 rollover and reset distinction", () => {
  const R1 = Date.parse("2026-09-01T00:00:00.000Z");
  const R2 = Date.parse("2026-10-01T00:00:00.000Z");

  it("detects genuine reset-window advancement (usage drop not required)", () => {
    // Genuine new cycle from LOW usage: 8% -> 1% must still be a rollover.
    assert.equal(
      detectProviderRollover(
        { resetsAtMs: R1, monthlyFraction: 0.08, observedAtMs: R1 - 15 * 86400000 },
        { resetsAtMs: R2, monthlyFraction: 0.01, observedAtMs: R1 + 15 * 86400000 },
      ),
      true,
    );
    // High -> low across a genuine reset.
    assert.equal(
      detectProviderRollover(
        { resetsAtMs: R1, monthlyFraction: 0.8, observedAtMs: R1 - 86400000 },
        { resetsAtMs: R2, monthlyFraction: 0.05, observedAtMs: R1 + 86400000 },
      ),
      true,
    );
    // Same window, usage climbing: no rollover.
    assert.equal(
      detectProviderRollover(
        { resetsAtMs: R1, monthlyFraction: 0.1, observedAtMs: R1 - 86400000 },
        { resetsAtMs: R1, monthlyFraction: 0.19, observedAtMs: R1 - 80000000 },
      ),
      false,
    );
    assert.equal(
      detectProviderRollover(null, { resetsAtMs: R2, monthlyFraction: 0.05, observedAtMs: R2 - 86400000 }),
      false,
    );
  });

  it("ignores millisecond/second jitter (never rollover, never reset change)", () => {
    const base = Date.parse("2026-09-13T11:13:41.000Z");
    const jitterA = base + 824;
    const jitterB = base + 569;
    const observed = base - 86400000;
    assert.equal(
      detectProviderRollover(
        { resetsAtMs: jitterA, monthlyFraction: 0.19, observedAtMs: observed },
        { resetsAtMs: jitterB, monthlyFraction: 0.19, observedAtMs: observed + 60000 },
      ),
      false,
    );
    // Jitter crossing a second boundary is still jitter.
    assert.equal(
      detectProviderRollover(
        { resetsAtMs: base + 999, monthlyFraction: 0.19, observedAtMs: observed },
        { resetsAtMs: base + 1001, monthlyFraction: 0.19, observedAtMs: observed + 60000 },
      ),
      false,
    );
    // Jitter never creates a snapshot.
    assert.equal(
      shouldStoreProviderSnapshot({
        previous: { monthlyFraction: 0.19, monthlyStatus: "ok", providerResetsAtMs: jitterA, observedAtMs: observed },
        next: { monthlyFraction: 0.19, monthlyStatus: "ok", providerResetsAtMs: jitterB },
        nowMs: observed + 120000,
      }),
      false,
    );
  });

  it("does not mistake a small pre-reset correction for a new cycle", () => {
    const nowMs = R1 - 10 * 86400000;
    assert.equal(
      detectProviderRollover(
        { resetsAtMs: R1, monthlyFraction: 0.19, observedAtMs: nowMs },
        { resetsAtMs: R1 + 5 * 60000, monthlyFraction: 0.19, observedAtMs: nowMs + 60000 },
      ),
      false,
    );
  });

  it("keeps a same-window usage collapse as a defensive rollover signal", () => {
    assert.equal(
      detectProviderRollover(
        { resetsAtMs: R1, monthlyFraction: 0.8, observedAtMs: R1 - 86400000 },
        { resetsAtMs: R1, monthlyFraction: 0.5, observedAtMs: R1 - 80000000 },
      ),
      true,
    );
  });

  it("does NOT require RESET when contract/provider resets differ in the same cycle", () => {
    // Contract resets 11:29, provider resets 12:13 the same Sep 29; today is
    // well before reset. Different anchors, same cycle: compare normally.
    const day = 86400000;
    const trackingStart = Date.UTC(2026, 7, 30, 10, 29, 0);
    const contractReset = Date.UTC(2026, 8, 29, 9, 29, 0);
    const providerReset = Date.UTC(2026, 8, 29, 12, 13, 0);
    assert.ok(providerReset > contractReset);
    const contract: V2Contract = {
      baseline: 0.048,
      trackingStartMs: trackingStart,
      resetAtMs: contractReset,
      checkTime: "12:00",
      hardLimit: 1,
      safetyReserve: 0,
      plannedCeiling: 1,
      checkpoints: [
        { day: 1, date: "2026-09-05", checkTime: "12:00", timestampMs: trackingStart + 6 * day, timestamp: new Date(trackingStart + 6 * day).toISOString(), ceiling: 0.2273 },
      ],
    };
    const nowMs = contractReset - 5 * day;
    const result = evaluateComparison({
      contract,
      nowMs,
      provider: {
        monthlyFraction: 0.19,
        monthlyStatus: "ok",
        providerResetsAtMs: providerReset,
        providerResetsAtIso: new Date(providerReset).toISOString(),
        observedAtMs: nowMs - 60000,
      },
    });
    assert.notEqual(result.status, "RESET_REQUIRED");
    assert.equal(result.status, "ON_TRACK");
    // Both resets remain visible and distinct.
    assert.equal(result.contractResetMs, contractReset);
    assert.equal(result.providerResetsAtMs, providerReset);
  });

  it("requires RESET_REQUIRED on genuine provider rollover even when under ceiling", () => {
    const contract = contractFixture();
    const nowMs = contract.checkpoints[2]!.timestampMs + 1000;
    const result = evaluateComparison({
      contract,
      nowMs,
      provider: reading({
        monthlyFraction: 0.05,
        observedAtMs: nowMs - 1000,
        providerResetsAtMs: Date.parse("2026-10-29T21:29:00.000Z"),
        providerResetsAtIso: "2026-10-29T21:29:00.000Z",
      }),
      previousProvider: prev({
        resetsAtMs: Date.parse("2026-09-29T21:29:00.000Z"),
        monthlyFraction: 0.8,
        observedAtMs: Date.parse("2026-09-20T12:00:00.000Z"),
      }),
    });
    assert.equal(result.status, "RESET_REQUIRED");
    assert.equal(result.isRollover, true);
  });

  it("requires RESET_REQUIRED when the contract cycle ended", () => {
    const contract = contractFixture();
    const result = evaluateComparison({
      contract,
      nowMs: contract.resetAtMs,
      provider: reading({ monthlyFraction: 0.05, observedAtMs: contract.resetAtMs - 1000 }),
    });
    assert.equal(result.status, "RESET_REQUIRED");
  });

  it("keeps contract reset and provider reset separately", () => {
    const contract = contractFixture();
    const nowMs = contract.checkpoints[2]!.timestampMs + 1000;
    const providerResetsAtMs = Date.parse("2026-10-13T06:06:01.000Z");
    const result = evaluateComparison({
      contract,
      nowMs,
      provider: reading({ observedAtMs: nowMs - 1000, providerResetsAtMs, providerResetsAtIso: "2026-10-13T06:06:01.000Z" }),
    });
    assert.equal(result.contractResetMs, contract.resetAtMs);
    assert.equal(result.providerResetsAtMs, providerResetsAtMs);
    assert.notEqual(result.contractResetMs, result.providerResetsAtMs);
  });
});

// ---------------------------------------------------------------------------
// Snapshot / refresh rules
// ---------------------------------------------------------------------------

describe("v2 snapshot and refresh rules", () => {
  it("stores on first observation, change, or >1h age (jitter never stores)", () => {
    const nowMs = 10_000_000;
    assert.equal(
      shouldStoreProviderSnapshot({ previous: null, next: { monthlyFraction: 0.1, monthlyStatus: "ok", providerResetsAtMs: 5 }, nowMs }),
      true,
    );
    const prevRow = { monthlyFraction: 0.1, monthlyStatus: "ok", providerResetsAtMs: 5, observedAtMs: nowMs - 1000 };
    assert.equal(shouldStoreProviderSnapshot({ previous: prevRow, next: { monthlyFraction: 0.1, monthlyStatus: "ok", providerResetsAtMs: 5 }, nowMs }), false);
    assert.equal(shouldStoreProviderSnapshot({ previous: prevRow, next: { monthlyFraction: 0.11, monthlyStatus: "ok", providerResetsAtMs: 5 }, nowMs }), true);
    assert.equal(shouldStoreProviderSnapshot({ previous: prevRow, next: { monthlyFraction: 0.1, monthlyStatus: "rate-limited", providerResetsAtMs: 5 }, nowMs }), true);
    assert.equal(shouldStoreProviderSnapshot({ previous: prevRow, next: { monthlyFraction: 0.1, monthlyStatus: "ok", providerResetsAtMs: 6 + V2_RESET_TOLERANCE_MS + 1 }, nowMs }), true);
    // Within tolerance: same window, no store.
    assert.equal(shouldStoreProviderSnapshot({ previous: prevRow, next: { monthlyFraction: 0.1, monthlyStatus: "ok", providerResetsAtMs: 5 + 30_000 }, nowMs }), false);
    const old = { monthlyFraction: 0.1, monthlyStatus: "ok", providerResetsAtMs: 5, observedAtMs: nowMs - V2_SNAPSHOT_MAX_AGE_MS - 1 };
    assert.equal(shouldStoreProviderSnapshot({ previous: old, next: { monthlyFraction: 0.1, monthlyStatus: "ok", providerResetsAtMs: 5 }, nowMs }), true);
    assert.equal(V2_SNAPSHOT_MAX_AGE_MS, 60 * 60 * 1000);
  });

  it("auto-refreshes at >=2min and cools down within 30-60s", () => {
    const nowMs = 1_000_000;
    assert.equal(shouldAutoRefresh(nowMs, null), true);
    assert.equal(shouldAutoRefresh(nowMs, nowMs - 119000), false);
    assert.equal(shouldAutoRefresh(nowMs, nowMs - 120000), true);
    assert.equal(V2_AUTO_REFRESH_MS, 2 * 60 * 1000);
    assert.equal(isRefreshCooldown(nowMs, null), false);
    assert.equal(isRefreshCooldown(nowMs, nowMs - 1000), true);
    assert.equal(isRefreshCooldown(nowMs, nowMs - V2_REFRESH_COOLDOWN_MS), false);
    assert.ok(V2_REFRESH_COOLDOWN_MS >= 30000 && V2_REFRESH_COOLDOWN_MS <= 60000);
  });

  function stubClient(rows: Record<string, unknown>[], inserted: Record<string, unknown>[]) {
    return {
      from(table: string) {
        assert.equal(table, "opencode_go_provider_snapshots");
        return {
          select: () => ({
            order: () => ({
              order: () => ({
                limit: (n: number) => {
                  if (n === 1 || n === 2) {
                    const data = rows.slice(0, n);
                    if (n === 1) {
                      return { maybeSingle: async () => ({ data: data[0] ?? null, error: null }) };
                    }
                    return Promise.resolve({ data, error: null });
                  }
                  return Promise.resolve({ data: rows, error: null });
                },
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              maybeSingle: async () => {
                const created = { id: "new-id", created_at: new Date().toISOString(), ...row };
                inserted.push(created);
                return { data: created, error: null };
              },
            }),
          }),
        };
      },
    };
  }

  it("refresh stores the first snapshot with observed/fetched semantics", async () => {
    const inserted: Record<string, unknown>[] = [];
    const client = stubClient([], inserted);
    const okFetch = (async () => jsonResponse(monthlyPayload())) as typeof fetch;
    const first = await refreshProviderSnapshot(client as never, Date.now(), {
      apiKey: "test-key",
      fetchFn: okFetch,
    });
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.stored, true);
    assert.equal(inserted.length, 1);
    const row = inserted[0] as Record<string, string>;
    // observed_at (request start) <= fetched_at (response received).
    assert.ok(Date.parse(row.observed_at as string) <= Date.parse(row.fetched_at as string));
    assert.equal(row.source, "opencode_api");
  });

  it("refresh failures preserve the last snapshot with a sanitized message", async () => {
    const previous = {
      id: "prev",
      observed_at: new Date(Date.now() - 60000).toISOString(),
      fetched_at: new Date(Date.now() - 60000).toISOString(),
      monthly_percent: 0.19,
      monthly_status: "ok",
      provider_resets_at: "2026-10-01T00:00:00.000Z",
      source: "opencode_api",
      fetch_duration_ms: 100,
      created_at: new Date(Date.now() - 60000).toISOString(),
    };
    const inserted: Record<string, unknown>[] = [];
    const client = stubClient([previous], inserted);
    const failing = (async () => jsonResponse({}, 500)) as typeof fetch;
    const outcome = await refreshProviderSnapshot(client as never, Date.now(), {
      apiKey: "sk-live-secret-xyz-999",
      fetchFn: failing,
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.doesNotMatch(outcome.message, /sk-live-secret/);
      assert.doesNotMatch(JSON.stringify(inserted), /sk-live-secret/);
    }
    assert.equal(inserted.length, 0);
  });

  it("refresh skips unchanged recent reads without appending", async () => {
    const nowMs = Date.now();
    const previous = {
      id: "prev",
      observed_at: new Date(nowMs - 60000).toISOString(),
      fetched_at: new Date(nowMs - 60000).toISOString(),
      monthly_percent: 0.19,
      monthly_status: "ok",
      provider_resets_at: "2026-10-01T00:00:00.000Z",
      source: "opencode_api",
      fetch_duration_ms: 100,
      created_at: new Date(nowMs - 60000).toISOString(),
    };
    const inserted: Record<string, unknown>[] = [];
    const client = stubClient([previous], inserted);
    const sameFetch = (async () =>
      jsonResponse(monthlyPayload({ percent: 19, status: "ok", resetsAt: "2026-10-01T00:00:00.000Z" }))) as typeof fetch;
    const outcome = await refreshProviderSnapshot(client as never, nowMs, {
      apiKey: "test-key",
      fetchFn: sameFetch,
    });
    assert.equal(outcome.ok, true);
    if (outcome.ok) assert.equal(outcome.stored, false);
    assert.equal(inserted.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint rows: first-in-window semantics, Upcoming, current, no leaks
// ---------------------------------------------------------------------------

describe("v2 checkpoint history semantics", () => {
  function rowsFor(history: ReturnType<typeof snapshotRow>[], nowMs: number) {
    const { contract } = windowContract();
    const comparison = evaluateComparison({
      contract,
      nowMs,
      provider: {
        monthlyFraction: 0.19,
        monthlyStatus: "ok",
        providerResetsAtMs: Date.parse("2026-10-01T00:00:00.000Z"),
        providerResetsAtIso: "2026-10-01T00:00:00.000Z",
        observedAtMs: nowMs - 60000,
      },
    });
    return buildV2CheckpointRows({
      contract,
      comparison,
      providerHistoryNewestFirst: [...history].reverse(),
      nowMs,
    });
  }

  function viewFor(history: ReturnType<typeof snapshotRow>[], nowMs: number) {
    const contract = contractFixture();
    const comparison = evaluateComparison({
      contract,
      nowMs,
      provider: reading({ monthlyFraction: 0.19, observedAtMs: nowMs - 60000 }),
    });
    return buildV2CheckpointRows({ contract, comparison, providerHistoryNewestFirst: [...history].reverse(), nowMs });
  }

  it("marks future rows Upcoming (never Missing) and subdues them", async () => {
    const contract = contractFixture();
    const nowMs = contract.checkpoints[0]!.timestampMs + 1000;
    const rows = viewFor([], nowMs);
    const future = rows.filter((r) => r.isFuture);
    assert.ok(future.length > 0);
    for (const row of future) {
      assert.equal(row.status, "Upcoming");
      assert.equal(row.providerObservation, null);
      assert.equal(row.headroom, null);
    }
    const source = await readFile(new URL("../components/opencode-go/checkpoint-table.tsx", import.meta.url), "utf8");
    assert.match(source, /Upcoming/);
    // No row ever renders a Missing status value.
    assert.doesNotMatch(source, /status:\s*["']Missing["']|return\s*["']Missing["']|>\s*Missing\s*</);
  });

  it("strongly highlights the current row with live values", async () => {
    const contract = contractFixture();
    const nowMs = contract.checkpoints[1]!.timestampMs + 1000;
    const live = snapshotRow(nowMs - 60000, 0.19, Date.parse("2026-09-29T21:29:00.000Z"));
    const rows = viewFor([live], nowMs);
    const current = rows.filter((r) => r.isCurrent);
    assert.equal(current.length, 1);
    assert.equal(current[0]!.date, "2026-09-01");
    assert.equal(current[0]!.providerObservation, 0.19);
    assert.ok(current[0]!.headroom != null);
    const source = await readFile(new URL("../components/opencode-go/checkpoint-table.tsx", import.meta.url), "utf8");
    assert.match(source, /aria-current/);
    assert.match(source, /current/);
  });

  it("never invents provider history for past checkpoints", () => {
    const contract = contractFixture();
    const nowMs = contract.checkpoints[2]!.timestampMs + 1000;
    const rows = viewFor([], nowMs);
    const past = rows.filter((r) => !r.isFuture && !r.isCurrent);
    assert.ok(past.length > 0);
    for (const row of past) {
      assert.equal(row.providerObservation, null);
      assert.equal(row.headroom, null);
    }
  });

  it("assigns first snapshot in [checkpoint, next) — not same-calendar-day", () => {
    const { cp1, cp2 } = windowContract();
    const reset = Date.parse("2026-10-01T00:00:00.000Z");
    // 00:30 BEFORE the 12:00 checkpoint must not attach to it.
    const before = snapshotRow(cp1 - 11.5 * 3600000, 0.05, reset);
    // 23:45 after the checkpoint is the first in-window reading.
    const late = snapshotRow(cp1 + 11.75 * 3600000, 0.19, reset);
    const nowMs = cp2 + 1000;
    const rows = rowsFor([before, late], nowMs);
    const first = rows.find((r) => r.day === 1)!;
    // The pre-checkpoint reading is ignored; the in-window reading wins.
    assert.equal(first.providerObservation, 0.19);
    assert.ok(Math.abs((first.headroom as number) - (0.2 - 0.19)) < 1e-12);
  });

  it("prefers the earliest in-window snapshot over later ones", () => {
    const { cp1, cp2 } = windowContract();
    const reset = Date.parse("2026-10-01T00:00:00.000Z");
    const early = snapshotRow(cp1 + 3600000, 0.1, reset);
    const later = snapshotRow(cp1 + 5 * 3600000, 0.15, reset);
    const nowMs = cp2 + 1000;
    const rows = rowsFor([early, later], nowMs);
    // Day 1 is past here (active is day 2); historical = first in window.
    const first = rows.find((r) => r.day === 1)!;
    assert.equal(first.isCurrent, false);
    assert.equal(first.providerObservation, 0.1);
  });

  it("never leaks prior/next-cycle snapshots into an active contract", () => {
    const { contract, cp1, cp2 } = windowContract();
    const reset = Date.parse("2026-10-01T00:00:00.000Z");
    const priorCycle = snapshotRow(contract.trackingStartMs - 3600000, 0.9, Date.parse("2026-09-01T00:00:00.000Z"));
    const nextCycle = snapshotRow(contract.resetAtMs + 3600000, 0.02, Date.parse("2026-11-01T00:00:00.000Z"));
    const inWindow = snapshotRow(cp1 + 3600000, 0.12, reset);
    const nowMs = cp2 + 1000;
    const rows = buildV2CheckpointRows({
      contract,
      comparison: evaluateComparison({
        contract,
        nowMs,
        provider: {
          monthlyFraction: 0.19,
          monthlyStatus: "ok",
          providerResetsAtMs: reset,
          providerResetsAtIso: new Date(reset).toISOString(),
          observedAtMs: nowMs - 1000,
        },
      }),
      providerHistoryNewestFirst: [inWindow, nextCycle, priorCycle],
      nowMs,
    });
    const values = rows.map((r) => r.providerObservation);
    assert.ok(!values.includes(0.9), "prior-cycle snapshot must not appear");
    assert.ok(!values.includes(0.02), "next-cycle snapshot must not appear");
    // The in-window reading is used for history; the live reading for current.
    assert.ok(values.includes(0.12));
  });

  it("shows no live observation on the current row once the contract expired", () => {
    const { contract } = windowContract();
    const nowMs = contract.resetAtMs + 3600000;
    const nextCycle = snapshotRow(nowMs - 1000, 0.02, Date.parse("2026-11-01T00:00:00.000Z"));
    const comparison = evaluateComparison({
      contract,
      nowMs,
      provider: {
        monthlyFraction: 0.02,
        monthlyStatus: "ok",
        providerResetsAtMs: Date.parse("2026-11-01T00:00:00.000Z"),
        providerResetsAtIso: "2026-11-01T00:00:00.000Z",
        observedAtMs: nowMs - 1000,
      },
    });
    assert.equal(comparison.status, "RESET_REQUIRED");
    const rows = buildV2CheckpointRows({
      contract,
      comparison,
      providerHistoryNewestFirst: [nextCycle],
      nowMs,
    });
    for (const row of rows) {
      assert.notEqual(row.providerObservation, 0.02);
    }
  });
});

// ---------------------------------------------------------------------------
// Persistence, background collection (CRON-only), migration
// ---------------------------------------------------------------------------

describe("v2 persistence and background collection", () => {
  it("adds an append-only provider snapshots table without touching other domains", async () => {
    const sql = await readFile(
      new URL("../supabase/migrations/20260906_013_opencode_go_provider_snapshots.sql", import.meta.url),
      "utf8",
    );
    assert.match(sql, /create table if not exists public\.opencode_go_provider_snapshots/);
    for (const col of ["observed_at", "fetched_at", "monthly_percent", "monthly_status", "provider_resets_at", "source", "fetch_duration_ms", "created_at"]) {
      assert.match(sql, new RegExp(col));
    }
    assert.match(sql, /source = 'opencode_api'/);
    assert.match(sql, /monthly_percent >= 0/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /revoke all on table public\.opencode_go_provider_snapshots from anon, authenticated/);
    assert.match(sql, /grant all on table public\.opencode_go_provider_snapshots to service_role/);
    assert.match(sql, /before update or delete on public\.opencode_go_provider_snapshots/);
    assert.match(sql, /set search_path = pg_catalog/);
    // Timestamp semantics documented (the API supplies no observation time).
    assert.match(sql, /observed_at/);
    const executable = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    assert.doesNotMatch(executable, /daily_usage_observations|recovered_monthly_usage|process_ccusage_import/);
    assert.doesNotMatch(executable, /opencode_go_imports/);
    // Forward-only: only creates the new table/indexes/trigger, never alters
    // or drops existing objects.
    assert.doesNotMatch(executable, /alter table public\.(?!opencode_go_provider_snapshots)/i);
    assert.doesNotMatch(executable, /drop table/i);
  });

  it("keeps provider writes off the contract table", async () => {
    const queries = await readFile(new URL("../lib/opencode-go/provider-queries.ts", import.meta.url), "utf8");
    assert.match(queries, /opencode_go_provider_snapshots/);
    assert.doesNotMatch(queries, /opencode_go_imports/);
    assert.doesNotMatch(queries, /daily_usage_observations|recovered_monthly_usage/);
    const refresh = await readFile(new URL("../lib/opencode-go/refresh.ts", import.meta.url), "utf8");
    assert.match(refresh, /provider-queries|insertProviderSnapshot|getLatestTwoProviderSnapshots/);
    assert.doesNotMatch(refresh, /opencode_go_imports/);
    assert.doesNotMatch(refresh, /daily_usage_observations|recovered_monthly_usage/);
  });

  it("uses a Hobby-safe daily cron with page-load/manual fallback", async () => {
    const vercel = await readFile(new URL("../vercel.json", import.meta.url), "utf8");
    assert.match(vercel, /\/api\/opencode-go\/collect/);
    assert.match(vercel, /0 4 \* \* \*/);
    assert.doesNotMatch(vercel, /\*\/15/);
    const collect = await readFile(new URL("../app/api/opencode-go/collect/route.ts", import.meta.url), "utf8");
    assert.match(collect, /CRON_SECRET/);
    assert.doesNotMatch(collect, /OPENCODE_GO_API_KEY/);
    // Page-load auto-refresh plus manual refresh keep the app correct without
    // frequent background collection.
    const dashboardSource = await readFile(new URL("../components/opencode-go/tracker-dashboard.tsx", import.meta.url), "utf8");
    assert.match(dashboardSource, /AutoRefresh/);
    assert.match(dashboardSource, /RefreshButton/);
    const env = await readFile(new URL("../.env.example", import.meta.url), "utf8");
    assert.match(env, /OPENCODE_GO_API_KEY/);
    assert.match(env, /CRON_SECRET/);
    assert.doesNotMatch(env, /NEXT_PUBLIC_OPENCODE_GO_API_KEY/);
  });

  it("restricts collection to CRON_SECRET (least privilege, no sessions)", async () => {
    const source = await readFile(new URL("../app/api/opencode-go/collect/route.ts", import.meta.url), "utf8");
    assert.match(source, /cronAuthorized/);
    assert.match(source, /Bearer/);
    assert.match(source, /status: 401/);
    assert.match(source, /status: 503/);
    assert.doesNotMatch(source, /getObservatoryAccess|hasObservatoryAccess/);
    assert.doesNotMatch(source, /console\.(log|error)/);
    assert.doesNotMatch(source, /Authorization.*apiKey|apiKey.*Authorization/i);
  });

  it("enforces a backend refresh cooldown in the refresh route", async () => {
    const source = await readFile(new URL("../app/api/opencode-go/refresh/route.ts", import.meta.url), "utf8");
    assert.match(source, /V2_REFRESH_COOLDOWN_MS|45/);
    assert.match(source, /status: 429/);
    assert.match(source, /Retry-After/);
    assert.match(source, /providerUnavailable/);
    assert.doesNotMatch(source, /OPENCODE_GO_API_KEY/);
    assert.doesNotMatch(source, /Bearer \$\{apiKey\}|authorization.*apiKey/i);
  });
});

// ---------------------------------------------------------------------------
// Security: no secret exposure, client import graph
// ---------------------------------------------------------------------------

describe("v2 security: no secret exposure", () => {
  it("keeps the secret out of browser bundles, storage, and responses", async () => {
    const dir = new URL("../components/opencode-go/", import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".tsx"));
    assert.ok(files.length >= 5);
    for (const file of files) {
      const source = await readFile(new URL(`../components/opencode-go/${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /OPENCODE_GO_API_KEY/);
      assert.doesNotMatch(source, /Bearer/);
      assert.doesNotMatch(source, /localStorage|sessionStorage/);
      // Secret-holding or store-writing modules never reach the browser.
      assert.doesNotMatch(source, /from "@\/lib\/opencode-go\/(provider|refresh|provider-queries)"/);
    }
    for (const route of [
      "../app/api/opencode-go/refresh/route.ts",
      "../app/api/opencode-go/usage/route.ts",
      "../app/api/opencode-go/collect/route.ts",
    ]) {
      const source = await readFile(new URL(route, import.meta.url), "utf8");
      assert.doesNotMatch(source, /localStorage|sessionStorage/);
      assert.doesNotMatch(source, /process\.env\.OPENCODE_GO_API_KEY/);
      assert.doesNotMatch(source, /console\.(log|error)/);
    }
    const providerQueries = await readFile(new URL("../lib/opencode-go/provider-queries.ts", import.meta.url), "utf8");
    assert.doesNotMatch(providerQueries, /OPENCODE_GO_API_KEY/);
  });

  it("never stores rolling/weekly windows or per-request telemetry", async () => {
    const migration = await readFile(
      new URL("../supabase/migrations/20260906_013_opencode_go_provider_snapshots.sql", import.meta.url),
      "utf8",
    );
    const executable = migration.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").toLowerCase();
    assert.doesNotMatch(executable, /rolling|weekly|per.request|telemetry|model|cost|token/);
  });
});

// ---------------------------------------------------------------------------
// UI contract: hierarchy, precision, chart, responsive, accessibility
// ---------------------------------------------------------------------------

describe("v2 ui contract", () => {
  it("answers the four questions above the fold in order", async () => {
    const source = await readFile(new URL("../components/opencode-go/tracker-dashboard.tsx", import.meta.url), "utf8");
    for (const copy of [
      "Monthly contract vs current usage",
      "Current monthly",
      "Safe now",
      "Safe headroom",
      "Today",
      "Next safe checkpoint",
      "Plan vs reality",
      "Monthly Safe Plan",
      "Provider remaining",
      "Safe contract headroom",
      "CheckpointTable",
      "RefreshButton",
      "{history}",
    ]) {
      assert.match(source, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    const refresh = await readFile(new URL("../components/opencode-go/refresh-button.tsx", import.meta.url), "utf8");
    assert.match(refresh, /Refresh usage/);
    const table = await readFile(new URL("../components/opencode-go/checkpoint-table.tsx", import.meta.url), "utf8");
    assert.match(table, /Checkpoint history/);
    const historyPanel = await readFile(new URL("../components/opencode-go/import-history.tsx", import.meta.url), "utf8");
    assert.match(historyPanel, /Import history/);
    assert.doesNotMatch(source, /5-hour|weekly|forecast|notification|per-request/i);
  });

  it("uses whole-percent precision for raw provider readings only", async () => {
    assert.equal(formatWholePercent(0.19), "19%");
    assert.equal(formatWholePercent(0.194), "19%");
    assert.equal(formatWholePercent(1), "100%");
    const dashboard = await readFile(new URL("../components/opencode-go/tracker-dashboard.tsx", import.meta.url), "utf8");
    assert.match(dashboard, /formatWholePercent\(comparison\.providerMonthly\)/);
    assert.match(dashboard, /formatWholePercent\(comparison\.providerRemaining\)/);
    // Contract ceilings and headroom keep decimals.
    assert.match(dashboard, /formatPercent\(comparison\.activeCeiling\)/);
    const table = await readFile(new URL("../components/opencode-go/checkpoint-table.tsx", import.meta.url), "utf8");
    assert.match(table, /formatWholePercent\(row\.providerObservation\)/);
    assert.match(table, /formatPercent\(row\.ceiling\)/);
    const chart = await readFile(new URL("../components/opencode-go/pace-chart.tsx", import.meta.url), "utf8");
    assert.match(chart, /Math\.round\(p\.providerObservation \* 100\)/);
    assert.doesNotMatch(chart, /provider \$\{[^}]*toFixed/);
  });

  it("uses one server/domain comparison model (no client duplication)", async () => {
    const dashboard = await readFile(new URL("../components/opencode-go/tracker-dashboard.tsx", import.meta.url), "utf8");
    assert.match(dashboard, /comparison/);
    assert.doesNotMatch(dashboard, /from "@\/lib\/opencode-go\/comparison"/);
    assert.doesNotMatch(dashboard, /evaluateComparison|getActiveContractState/);
    const clientFiles = ["refresh-button.tsx", "auto-refresh.tsx"];
    for (const file of clientFiles) {
      const source = await readFile(new URL(`../components/opencode-go/${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /evaluateComparison|getActiveContractState|comparison/i);
    }
    const page = await readFile(new URL("../app/opencode-go/page.tsx", import.meta.url), "utf8");
    assert.match(page, /buildV2View/);
    assert.match(page, /buildV2CheckpointRows/);
  });

  it("renders an accessible, compact plan-vs-reality chart", async () => {
    const source = await readFile(new URL("../components/opencode-go/pace-chart.tsx", import.meta.url), "utf8");
    assert.match(source, /role="img"/);
    assert.match(source, /<title>/);
    assert.match(source, /today/);
    assert.match(source, /tabIndex/);
    assert.match(source, /H = 120/);
    assert.doesNotMatch(source, /H = 220/);
  });

  it("supports desktop tables and mobile cards with current highlighting", async () => {
    const source = await readFile(new URL("../components/opencode-go/checkpoint-table.tsx", import.meta.url), "utf8");
    assert.match(source, /hidden.*md:block/);
    assert.match(source, /md:hidden/);
    assert.match(source, /aria-current/);
    for (const col of ["Checkpoint", "Safe ceiling", "Provider observation", "Headroom", "Status"]) {
      assert.match(source, new RegExp(col));
    }
  });

  it("combines status text, icon, and visual treatment (never color alone)", async () => {
    const source = await readFile(new URL("../components/opencode-go/tracker-status.tsx", import.meta.url), "utf8");
    for (const status of ["ON_TRACK", "NEAR_PLAN", "OVER_PACE", "LIMIT_EXCEEDED", "SYNC_STALE", "RESET_REQUIRED"]) {
      assert.match(source, new RegExp(status));
    }
    assert.match(source, /icon/);
    assert.match(source, /aria-label/);
  });

  it("keeps refresh and upload keyboard accessible with stable skeletons", async () => {
    const refresh = await readFile(new URL("../components/opencode-go/refresh-button.tsx", import.meta.url), "utf8");
    assert.match(refresh, /<button/);
    assert.match(refresh, /focus-visible/);
    assert.match(refresh, /disabled/);
    const upload = await readFile(new URL("../components/opencode-go/tracker-upload.tsx", import.meta.url), "utf8");
    assert.match(upload, /aria-label="Choose an \.xlsx tracker file"/);
    assert.match(upload, /Replace Monthly Safe Plan/);
    const loading = await readFile(new URL("../app/opencode-go/loading.tsx", import.meta.url), "utf8");
    assert.match(loading, /TelemetryRouteLoading/);
  });

  it("keeps contract and provider resets separately visible", async () => {
    const dashboard = await readFile(new URL("../components/opencode-go/tracker-dashboard.tsx", import.meta.url), "utf8");
    assert.match(dashboard, /Contract reset/);
    assert.match(dashboard, /Provider reset/);
  });

  it("builds checkpoint rows and views without fabricating history", () => {
    const contract = contractFixture();
    const nowMs = contract.checkpoints[2]!.timestampMs + 1000;
    const view = buildV2View({
      contractSnapshot: {
        timezone: "Africa/Casablanca",
        trackingStartsAt: new Date(contract.trackingStartMs).toISOString(),
        resetAt: new Date(contract.resetAtMs).toISOString(),
        checkTime: "12:00",
        baselineUsage: contract.baseline,
        hardLimit: 1,
        safetyReserve: 0,
        plannedCeiling: 1,
        checkpoints: contract.checkpoints.map((c) => ({
          day: c.day,
          date: c.date,
          checkTime: c.checkTime,
          timestamp: c.timestamp,
          ceiling: c.ceiling,
          workbookCeiling: null,
          actual: null,
        })),
        latestRecordedActual: { value: 0.048, source: "baseline", checkpointDate: null, checkpointTimestamp: null },
        workbookDiagnostics: { formulaValuesAvailable: false, formulaMismatchCount: 0, formulaWarnings: [] },
      },
      contractMeta: {
        filename: "plan.xlsx",
        importedAt: new Date(nowMs - 86400000).toISOString(),
        trackingStartIso: new Date(contract.trackingStartMs).toISOString(),
        resetAtIso: new Date(contract.resetAtMs).toISOString(),
        checkTime: "12:00",
        baseline: 0.048,
        hardLimit: 1,
        safetyReserve: 0,
        plannedCeiling: 1,
      },
      providerSnapshotsNewestFirst: [],
      nowMs,
    });
    assert.equal(view.hasContract, true);
    assert.equal(view.comparison?.status, "SYNC_STALE");
    assert.equal(view.providerSnapshot, null);
  });
});
