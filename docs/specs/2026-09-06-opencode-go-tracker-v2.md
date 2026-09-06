# OpenCode Go Tracker V2 — Product & Engineering Specification

**Repository:** `egawilldoit/token-observatory`
**Feature route:** `/opencode-go`
**Timezone:** `Africa/Casablanca`
**Scope:** One branch → one PR (`feat/opencode-go-tracker-v2`)
**Status:** Implementation-ready, MONTHLY ONLY

V2 is MONTHLY ONLY. Rolling/5-hour and weekly windows are not part of the
V2 UI or domain behavior.

---

## 1. Three separate truths

1. **Excel = MONTHLY SAFE USAGE CONTRACT.** The uploaded workbook defines the
   immutable safe plan for its cycle: baseline, tracking start, contract
   reset, hard limit, reserve, planned ceiling, checkpoint schedule,
   checkpoint ceilings, daily check time. API observations never mutate it.
2. **OpenCode Go API = REAL CURRENT MONTHLY USAGE.** Server-side
   `GET https://opencode.ai/zen/go/v1/usage` with `OPENCODE_GO_API_KEY`.
   Only `usage.monthly.percent`, `usage.monthly.status`, and
   `usage.monthly.resetsAt` participate in V2.
3. **Token Observatory = COMPARISON / decision layer.** One server/domain
   model joins contract and reality into status, headroom, and freshness.
   The frontend renders that result and never duplicates the logic.

Core question: "According to my monthly safe plan, am I still safe based on
my real OpenCode usage?"

Formula (percentage points, not relative percent):

```text
safe_headroom = contract_safe_ceiling - provider_monthly_usage
```

Example: safe plan 22.73%, provider actual 19.00% → headroom +3.73 pp →
ON TRACK.

---

## 2. Monthly API (server-side only)

- Endpoint: `GET https://opencode.ai/zen/go/v1/usage`
- Auth: `Authorization: Bearer <OPENCODE_GO_API_KEY>` (server env only)
- Use: `usage.monthly.percent` (0–100 scale → fraction via `/100`),
  `usage.monthly.status`, `usage.monthly.resetsAt`
- Ignore rolling and weekly in all V2 UI/domain behavior
- Typed, runtime-validated client with a 10s timeout and explicit codes:
  401, 403, 429, 5xx, timeout, malformed JSON/contract
- Never expose, log, store, or return the secret in browser JS, HTML,
  local/session storage, Supabase rows, API responses, or errors

Upstream reference: monthly `percent` is floored 0–100 used utilization,
`status` is `ok` or `rate-limited`, `resetsAt` is the subscription-anniversary
reset instant. `resetsAt` carries request-time millisecond jitter; the client
canonicalizes it to whole-second precision and treats instants within a
documented 60s tolerance as the same reset window, so jitter can never read
as a reset change, create a snapshot, trigger rollover, or force
RESET_REQUIRED.

---

## 3. Excel contract (Monthly Safe Plan)

The V1 workbook parser and import foundation are preserved and reframed as
the Monthly Safe Plan. The contract is immutable for its cycle. Active safe
ceiling: latest contract checkpoint with timestamp `<= now`; before the
first checkpoint the ceiling is the baseline. No interpolation is ever
invented. Also exposed: active checkpoint, next checkpoint, next safe
ceiling, time until next. Contract reset and provider reset are kept
separately.

---

## 4. Provider snapshots (append-only evidence)

Table `opencode_go_provider_snapshots`: id, observed_at/fetched_at,
monthly_percent (fraction), monthly_status, provider_resets_at,
source (`opencode_api`), fetch_duration_ms, created_at. The OpenCode API
supplies no observation timestamp: `observed_at` is when the collection
request started (closest proxy for the state read) and `fetched_at` is when
the response arrived. RLS enabled, no
browser grants, append-only trigger. No contract foreign key by design, so a
new-cycle observation can never attach to a previous contract. History before
the first snapshot is never fabricated. A snapshot is stored when monthly %
changes, status changes, reset changes beyond jitter tolerance, or the last
observation is >1h old. DB percent contract: `monthly_percent BETWEEN 0 AND
1` (migration 014; exhaustion is 100% / rate-limited, so >1 is meaningless).
Concurrent refreshes serialize through `append_opencode_go_provider_snapshot`
(advisory lock, re-read + rule inside the transaction, at most one insert).

---

## 5. Refresh

- Auto-refresh on `/opencode-go` when the latest snapshot is >=2min old
- Manual "Refresh usage" (keyboard accessible, 45s backend cooldown)
- Background collection via a Hobby-safe daily Vercel Cron
  (`/api/opencode-go/collect`, `CRON_SECRET`-only, least privilege) plus
  page-load/manual refresh. The daily cadence is valid on every Vercel plan
  (Hobby rejects sub-daily schedules at deploy time); the app stays correct
  without frequent collection because freshness degrades gracefully and any
  reading can be refreshed on demand.
- The last successful snapshot is preserved when OpenCode is unavailable

Freshness: LIVE <5m, RECENT 5–30m, STALE >30m. Freshness and comparison
status are independent.

---

## 6. Comparison engine (single server/domain model)

Precedence: RESET_REQUIRED > LIMIT_EXCEEDED > SYNC_STALE > OVER_PACE >
NEAR_PLAN > ON_TRACK.

- RESET_REQUIRED: the contract cycle ended and no next contract exists, or
  provider evidence proves a NEW monthly cycle began (normalized
  reset-window advancement beyond tolerance with temporal validation: the
  previous window must have ended, or the advancement is >= 1 day). A
  provider reset that merely differs from the contract reset within the same
  cycle (different anchors/cadences, e.g. 11:29 vs 12:13) is NOT a reset;
  both resets are displayed separately. Usage movement plays no role: a
  same-window collapse (e.g. 41% -> 29% with unchanged resetsAt) is a
  mid-cycle move, never a rollover.
- LIMIT_EXCEEDED: monthly >=100% or provider status rate-limited
- SYNC_STALE: no sufficiently recent provider reading (>30m or none)
- OVER_PACE: actual > active safe ceiling
- NEAR_PLAN: headroom in [0, 2pp] inclusive
- ON_TRACK: headroom >2pp

---

## 7. UI

Above the fold: where am I (current monthly), where should I be (safe now),
am I okay (status), how much safe room remains (headroom in pp). Sections:
hero status, current vs safe, safe headroom, Today (provider usage, safe
ceiling, provider remaining `100 - actual`, safe headroom), Next safe
checkpoint, Plan vs reality (compact chart, safe line plus real dots only,
today marker, accessible tooltips), Checkpoint history (Checkpoint | Safe
ceiling | Provider observation | Headroom | Status; future is Upcoming, never
Missing; current highlighted; future subdued; mobile cards. Historical
checkpoint observations use first-in-window assignment (first snapshot with
`checkpoint <= observed < next`, inside the contract window only); snapshots
from prior/next cycles never appear against a contract. Raw provider readings
render as whole percents (the API never supplies decimals); contract ceilings
and derived headroom keep decimals. Monthly Safe
Plan (filename, cycle, checkpoint count, check time, View/Replace; uploader
is secondary), compact Import history with expandable technical details.
Provider remaining and safe headroom are never combined. No 5-hour/weekly UI,
no request proxy, telemetry, model analytics, cost reconstruction,
forecasting, or notifications.
