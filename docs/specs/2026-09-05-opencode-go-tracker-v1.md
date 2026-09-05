# OpenCode Go Tracker V1 — Product & Engineering Specification

**Repository:** `egawilldoit/token-observatory`
**Feature route:** `/opencode-go`
**Timezone:** `Africa/Casablanca`
**Status:** Implementation-ready after review resolution
**Scope rule:** One implementation branch → one implementation PR
**Primary input:** OpenCode Go monthly tracker `.xlsx`
**Live OpenCode API integration:** **Not part of V1**

---

## 1. Purpose

Add an **OpenCode Go monthly-usage pacing tracker** to Token Observatory.

The feature accepts the existing OpenCode Go `.xlsx` monthly tracker as an **input format**, normalizes it into application data, recomputes the pacing model in application code, persists immutable import history, and presents a dashboard that answers:

- Is the latest required checkpoint recorded?
- Am I on pace?
- What is the allowed ceiling for the relevant checkpoint?
- How much verified headroom remains?
- How much monthly budget remains?
- When does the cycle reset?
- How has recorded usage tracked against the planned pace?

This feature belongs in Token Observatory because the repository already provides authenticated telemetry pages, protected mutation APIs, private Supabase storage, import history, hashing/deduplication patterns, and analytics-oriented UI.

OpenCode Go is a **separate telemetry domain** from ccusage.

---

## 2. Source-of-truth hierarchy

V1 has no direct OpenCode usage API integration.

The application must distinguish three kinds of truth.

### 2.1 Observational source

The observational source for V1 is the uploaded workbook:

- cycle baseline/current monthly usage at tracking start;
- tracking start;
- reset timestamp;
- daily checkpoint time;
- hard monthly limit;
- safety reserve;
- checkpoint rows;
- user-entered `Actual Usage` values.

These values are manually observed/maintained outside Token Observatory and imported through the workbook.

Token Observatory does **not** claim that an uploaded actual value is live data from OpenCode.

UI wording must therefore use phrases such as:

```text
Recorded usage
Last recorded usage
Recorded at Sep 5 checkpoint
```

and must not imply:

```text
Live OpenCode usage
Synced from OpenCode
Provider-verified usage
```

unless a future version actually adds such an integration.

### 2.2 Application authority

Token Observatory is authoritative for **derived calculations**:

- expected checkpoint schedule;
- planned ceiling;
- headroom;
- budget remaining;
- freshness;
- status;
- days/time until reset;
- formula reconciliation diagnostics.

The application recomputes these values from authoritative workbook inputs.

### 2.3 Non-authoritative workbook fields

The following workbook-derived values are diagnostic only:

- workbook `Status`;
- workbook `Headroom`;
- workbook formula results for planned ceilings;
- other cached derived formula values.

The application must never adopt a workbook formula result merely because it differs from the application calculation.

---

## 3. Non-negotiable invariants

1. **Do not merge OpenCode Go data into ccusage tables, views, parsers, dedupe logic, or accounting semantics.**
2. **Do not redesign the existing ccusage cross-machine dedupe system.**
3. The workbook is an **import format**, not the application UI.
4. The workbook's entered actuals are observations; application-derived pace/status is recomputed independently.
5. A stale or missing required checkpoint must never be presented as a confident current green state.
6. Production freshness/status decisions use server time, never client-supplied `now`.
7. All cycle/checkpoint calculations use `Africa/Casablanca`.
8. Internal percentage representation is fractional: `1.0 = 100%`.
9. Accepted raw workbooks are private.
10. Accepted normalized snapshots are immutable history.
11. Exact raw re-uploads are idempotent by SHA-256.
12. Same-cycle previously recorded actuals may not silently disappear.
13. Corrections are allowed only when the resulting cumulative series remains chronologically valid.
14. The implementation must use the repository's current authentication, allowlist, same-origin, privileged Supabase, security-header, and server-only query patterns.
15. The entire V1 ships through **one dedicated feature branch and one PR**.

---

## 4. Explicitly out of scope

V1 does not include:

- direct OpenCode account/API usage synchronization;
- OpenCode credential storage;
- automatic OpenCode scraping;
- spreadsheet rendering/editing;
- Microsoft Excel embedding;
- automatic collector/scheduler infrastructure;
- notifications/reminders;
- adaptive/rebalanced pacing;
- multiple workbook templates;
- project/session/model analytics for OpenCode Go;
- changes to ccusage collection;
- changes to ccusage import behavior;
- changes to ccusage cross-machine dedupe;
- canonical model mapping;
- pricing provenance;
- Windows Task Scheduler;
- Linux systemd integration;
- user-facing deletion, soft-delete, or tombstoning of OpenCode Go imports.

Adaptive pacing may be considered for V1.1.

A direct OpenCode usage API may be considered later **only if a reliable supported source exists**.

---

## 5. Reference workbook contract

The supplied workbook defines the supported V1 shape.

### 5.1 Required worksheet

```text
Monthly Tracker
```

### 5.2 Required title

```text
OpenCode Go — Monthly Usage Tracker
```

### 5.3 Required semantic labels

The parser must locate and validate these labels semantically rather than trusting only fixed coordinates:

```text
Current monthly usage
Tracking starts
Days until reset
Daily check time
Reset date/time
Hard monthly limit
Safety reserve
Planned ceiling at reset
Remaining usage budget
Avg additional usage/day
Daily checkpoint
```

### 5.4 Required checkpoint headers

```text
Day #
Date
Check Time
Max Monthly Usage
Actual Usage
Status
Headroom
```

### 5.5 Reference values

| Field | Expected value |
|---|---:|
| Baseline/current monthly usage | `0.048` = `4.8%` |
| Tracking starts | `2026-08-30 22:29` local |
| Reset | `2026-09-29 11:29` local |
| Hard monthly limit | `1.0` = `100%` |
| Safety reserve | `0.0` |
| Planned ceiling | `1.0` |
| Remaining starting budget | `0.952` = `95.2 percentage points` |
| Daily checkpoint time | `12:00` |
| Expected checkpoint count | `29` |
| First checkpoint | `2026-08-31 12:00` |
| Last checkpoint | `2026-09-28 12:00` |
| Sep 5 checkpoint ceiling | approximately `0.2272776681` = `22.7278%` |

The reference workbook contains no entered `Actual Usage` values.

---

## 6. Percentage representation

All percentage-like values use the same internal representation:

```text
0.048 = 4.8%
0.2272776681 = 22.72776681%
1.0 = 100%
```

Convert to `%` or percentage points only at presentation boundaries.

### 6.1 Range rules

For plan/configuration inputs:

```text
baselineUsage >= 0
hardLimit > 0
safetyReserve >= 0
safetyReserve < hardLimit
plannedCeiling = hardLimit - safetyReserve
baselineUsage <= plannedCeiling
```

`Actual Usage` values must be finite and non-negative.

An actual value may exceed `1.0` or the configured hard limit if that is what the workbook explicitly records, because the application must be able to represent a hard-limit breach.

### 6.2 Blank versus zero

For `Actual Usage`:

```text
blank cell / empty string => null
explicit numeric 0 / 0%   => 0
```

Zero is a real observation and must never be normalized to `null`.

---

## 7. Domain model

Keep the feature isolated under `lib/opencode-go`.

Recommended domain shape:

```ts
type OpenCodeGoCheckpoint = {
  day: number;
  date: string;       // YYYY-MM-DD in Africa/Casablanca
  checkTime: string;  // HH:mm
  timestamp: string;  // normalized instant / ISO representation

  ceiling: number;    // app-computed fraction
  workbookCeiling: number | null;

  actual: number | null;
};

type OpenCodeGoFormulaWarning = {
  field: string;
  checkpointDay?: number;
  workbookValue: number;
  applicationValue: number;
};

type OpenCodeGoTrackerSnapshot = {
  timezone: "Africa/Casablanca";

  trackingStartsAt: string;
  resetAt: string;
  checkTime: string;

  baselineUsage: number;
  hardLimit: number;
  safetyReserve: number;
  plannedCeiling: number;

  checkpoints: OpenCodeGoCheckpoint[];

  latestRecordedActual: {
    value: number;
    source: "checkpoint" | "baseline";
    checkpointDate: string | null;
    checkpointTimestamp: string | null;
  };

  workbookDiagnostics: {
    formulaValuesAvailable: boolean;
    formulaMismatchCount: number;
    formulaWarnings: OpenCodeGoFormulaWarning[];
  };
};
```

Do not place these types in `lib/ccusage`.

---

## 8. Time authority

Freshness and status depend on time and therefore need a single authority.

### 8.1 Production clock

Production uses:

```text
server Date.now()
    ↓
UTC instant
    ↓
convert/render/compare using Africa/Casablanca
```

Requirements:

- never accept a client-supplied `now`;
- never use browser time as freshness authority;
- do not trust workbook file modification timestamps;
- do not trust XLSX metadata timestamps for ordering;
- no custom clock-skew tolerance is introduced in V1.

Infrastructure/server clock correctness is an operational dependency.

### 8.2 Test clock

Domain functions should accept/inject a deterministic `now` for tests.

The production route/page must supply server time.

This permits deterministic acceptance tests without weakening production time authority.

---

## 9. Expected checkpoint schedule

The application, not the workbook, defines the expected checkpoint set from:

```text
trackingStart
resetAt
checkTime
timezone = Africa/Casablanca
```

### 9.1 Generation algorithm

Enumerate local calendar dates covering the tracking-start date through the reset date.

For each local date:

```text
candidate = local date + configured checkTime
```

Include the candidate if and only if:

```text
candidate > trackingStart
AND
candidate < resetAt
```

Sort included candidates ascending.

Assign:

```text
Day # = 1..N
```

in that order.

This algorithm intentionally handles partial first and last days.

#### Reference cycle

```text
trackingStart = Aug 30 2026 22:29
checkTime     = 12:00
resetAt       = Sep 29 2026 11:29
```

Therefore:

- Aug 30 12:00 is excluded because it is before tracking start.
- Sep 29 12:00 is excluded because it is after reset.
- Aug 31 through Sep 28 are included.
- expected checkpoint count = **29**.

### 9.2 Workbook schedule validation

The workbook checkpoint table must match the generated schedule exactly:

- same count;
- same dates;
- same check time;
- same order;
- contiguous `Day #` values;
- no duplicate timestamps;
- no missing expected timestamp;
- no extra timestamp.

A schedule mismatch is a `422` validation failure.

---

## 10. Pacing calculations

### 10.1 Planned ceiling

```text
plannedCeiling = hardLimit - safetyReserve
```

### 10.2 Remaining starting budget

```text
remainingStartingBudget = plannedCeiling - baselineUsage
```

### 10.3 Checkpoint ceiling

For checkpoint timestamp `t`:

```text
progress =
  (t - trackingStart)
  /
  (resetAt - trackingStart)
```

Then:

```text
rawCeiling =
  baselineUsage
  +
  (plannedCeiling - baselineUsage) * progress
```

Bound it:

```text
ceiling =
  max(
    baselineUsage,
    min(plannedCeiling, rawCeiling)
  )
```

All timestamp arithmetic represents real instants corresponding to `Africa/Casablanca` local schedule values.

### 10.4 Latest recorded actual

Define exactly:

```text
latestRecordedActual =
  most recent checkpoint by timestamp
  whose Actual Usage is non-null
```

If no checkpoint has a non-null actual:

```text
latestRecordedActual = baselineUsage
source = baseline
```

This value is for **recorded-history display**.

It is never promoted to a current checkpoint observation when the latest required checkpoint is missing.

### 10.5 Budget remaining

Use:

```text
budgetRemaining =
  max(0, plannedCeiling - latestRecordedActual.value)
```

When the source is baseline, label it as baseline-derived.

When freshness is `UPDATE_DUE`, do not describe this as verified "room available today"; it is only remaining budget relative to the last recorded observation.

### 10.6 Headroom

Headroom is meaningful only for a required checkpoint with an actual recorded at that checkpoint:

```text
headroom =
  requiredCheckpoint.ceiling
  -
  requiredCheckpoint.actual
```

Positive = below pace.

Negative = above pace.

Do not compute/display "safe additional usage today" from stale data.

### 10.7 Near-limit threshold

V1 uses an **absolute** threshold:

```text
0 <= headroom <= 0.02
```

where `0.02` means **2 percentage points**.

This is deliberately absolute, not relative to the day's ceiling.

The threshold may be revisited in V1.1.

### 10.8 Optional average remaining allowance

If shown, this is informational only.

It must:

- use the latest recorded actual;
- be hidden or explicitly marked stale during `UPDATE_DUE`;
- never modify the original planned ceiling schedule.

Adaptive future re-planning remains out of scope.

---

## 11. Freshness model

Freshness is a correctness requirement.

### 11.1 Required checkpoint

At server `now`, the required checkpoint is:

```text
latest expected checkpoint
whose timestamp <= now
```

provided the cycle has not reset.

### 11.2 Fresh state

The tracker is fresh when:

- no checkpoint is due yet; or
- the latest required checkpoint has a non-null actual.

### 11.3 Update due

`UPDATE_DUE` applies when:

```text
now < resetAt
AND
a required checkpoint exists
AND
requiredCheckpoint.actual == null
```

An earlier actual does not make the current checkpoint fresh.

### 11.4 Latest recorded usage under UPDATE_DUE

When `UPDATE_DUE`, show:

```text
latestRecordedActual
```

using the exact selection rule in Section 10.4.

Examples:

```text
Sep 3 actual = 15%
Sep 4 actual = 18%
Sep 5 actual = null

now = Sep 5 14:00

Last recorded usage = 18%
Recorded checkpoint = Sep 4
Status = UPDATE_DUE
```

If no checkpoint actual exists:

```text
Last recorded usage = baseline 4.8%
Source = cycle baseline
Status = UPDATE_DUE
```

Never relabel either value as a Sep 5 current observation.

---

## 12. Pre-first-checkpoint behavior

Before the first expected checkpoint becomes due:

- the tracker is not stale;
- there is no required actual yet;
- display the baseline as the starting observation;
- show the next checkpoint timestamp and planned ceiling;
- do **not** calculate headroom against a checkpoint that has not occurred;
- do **not** show "safe additional usage today";
- show explicit copy such as:

```text
First checkpoint not due yet
Starting observation: 4.8%
Next checkpoint: Aug 31 at 12:00
Next planned ceiling: 6.6%
```

For status purposes V1 may render the hero as `ON TRACK`, but it must include the explicit **checkpoint not due yet** qualifier and must not imply a verified checkpoint result.

---

## 13. Status model

Use:

```ts
type OpenCodeGoStatus =
  | "RESET_REQUIRED"
  | "LIMIT_EXCEEDED"
  | "UPDATE_DUE"
  | "OVER_PACE"
  | "NEAR_LIMIT"
  | "ON_TRACK";
```

### 13.1 Precedence

Evaluate in this order:

1. `RESET_REQUIRED`
2. `LIMIT_EXCEEDED`
3. `UPDATE_DUE`
4. `OVER_PACE`
5. `NEAR_LIMIT`
6. `ON_TRACK`

### 13.2 RESET_REQUIRED

```text
now >= resetAt
```

The uploaded cycle belongs to the previous cycle.

### 13.3 LIMIT_EXCEEDED

Before reset, if:

```text
latestRecordedActual.value >= hardLimit
```

then:

```text
LIMIT_EXCEEDED
```

This can supersede `UPDATE_DUE` because it represents a known recorded hard-limit breach.

The UI must still show the timestamp/source of that recorded value.

### 13.4 UPDATE_DUE

Use Section 11.3.

### 13.5 OVER_PACE

For a fresh required checkpoint:

```text
requiredCheckpoint.actual > requiredCheckpoint.ceiling
AND
requiredCheckpoint.actual < hardLimit
```

### 13.6 NEAR_LIMIT

For a fresh required checkpoint:

```text
0 <= headroom <= 0.02
```

### 13.7 ON_TRACK

For a fresh required checkpoint:

```text
requiredCheckpoint.actual <= requiredCheckpoint.ceiling
AND
headroom > 0.02
```

Before the first checkpoint, use the qualified pre-first behavior in Section 12.

---

## 14. Reference status acceptance cases

### 14.1 Missing Sep 5 actual

At:

```text
2026-09-05 14:29 Africa/Casablanca
```

with no checkpoint actuals:

```text
status = UPDATE_DUE
last recorded usage = baseline 4.8%
last recorded source = baseline
Sep 5 scheduled ceiling ≈ 22.7278%
```

The application must **not** say:

```text
17.9 pp safe headroom
```

because there is no Sep 5 actual.

### 14.2 Intermediate actuals exist but latest is missing

```text
Sep 3 = 15.0%
Sep 4 = 18.0%
Sep 5 = blank
now = Sep 5 14:29
```

Expected:

```text
status = UPDATE_DUE
last recorded usage = 18.0%
last recorded checkpoint = Sep 4
```

### 14.3 ON TRACK

If Sep 5 actual is `18.2%`, the application must report `ON_TRACK` with headroom approximately `+4.53 pp` against the Sep 5 ceiling.

### 14.4 NEAR LIMIT

If Sep 5 actual is `21.7%`, the application must report `NEAR_LIMIT` with headroom approximately `+1.03 pp`.

### 14.5 OVER PACE

If Sep 5 actual is `27.4%`, the application must report `OVER_PACE`, approximately `+4.67 pp` above pace.

### 14.6 Hard limit

If latest recorded actual is `100%`, the application must report `LIMIT_EXCEEDED`.

### 14.7 Reset

At or after `2026-09-29 11:29 Africa/Casablanca`, the application must report `RESET_REQUIRED`.

---

## 15. Workbook parsing rules

The parser must reject unsupported files rather than guess.

### 15.1 Accept

- `.xlsx` OOXML workbook;
- required `Monthly Tracker` sheet;
- required title;
- required labels;
- required checkpoint headers;
- valid numeric plan inputs;
- valid Excel date/time cells;
- blank actual cells;
- explicit zero actuals;
- non-null actuals;
- formula cells in derived columns.

### 15.2 Reject

Return controlled `422` validation for:

- missing required sheet;
- incorrect/missing title;
- missing semantic labels;
- missing checkpoint headers;
- invalid dates/times;
- `trackingStart >= resetAt`;
- invalid baseline/limit/reserve relationship;
- non-finite or negative actual;
- malformed percentage cells;
- duplicate checkpoint timestamps;
- non-increasing checkpoint timestamps;
- inconsistent checkpoint time;
- non-contiguous day numbers;
- missing expected checkpoint;
- extra checkpoint;
- checkpoint outside the generated cycle;
- malformed workbook;
- macro/VBA content;
- encrypted workbook;
- unsafe ZIP paths;
- workbook exceeding configured compressed/decompressed limits.

---

## 16. Actual usage chronology and correction policy

The metric is cumulative monthly usage.

Therefore every **accepted snapshot** must have a chronologically non-decreasing sequence of non-null actual values.

Example valid snapshot:

```text
Sep 3 = 15.0%
Sep 4 = 17.5%
Sep 5 = 20.0%
```

Example invalid snapshot:

```text
Sep 3 = 19.0%
Sep 4 = 17.5%
```

### 16.1 Corrections across imports

A same-cycle upload may revise a previously non-null value upward or downward.

Example:

Previous accepted snapshot:

```text
Sep 3 = 15%
Sep 4 = 20%
Sep 5 = null
```

New upload:

```text
Sep 3 = 15%
Sep 4 = 18%
Sep 5 = 21%
```

This is valid because the **new complete resulting sequence** remains non-decreasing.

The fact that Sep 4 changed from `20%` to `18%` is preserved automatically because accepted snapshots are immutable history.

No in-place mutation of the prior snapshot occurs.

### 16.2 Null regression

A previously accepted non-null actual may not become null in a later same-cycle snapshot.

Previous:

```text
Sep 4 = 18%
```

New:

```text
Sep 4 = blank
```

Result:

```text
409 history regression
```

This protects against uploading an older local copy.

### 16.3 Newly filled actual

Previous:

```text
Sep 5 = null
```

New:

```text
Sep 5 = 20%
```

Accept if the resulting full sequence is valid.

---

## 17. Same-cycle identity and ordering

### 17.1 Cycle identity

For V1, the billing/tracker cycle is identified by:

```text
trackingStart
+
resetAt
```

normalized to instants derived from `Africa/Casablanca`.

### 17.2 Structural plan stability

After the first accepted snapshot for a cycle, subsequent snapshots with the same cycle identity must preserve:

- baseline usage;
- hard limit;
- safety reserve;
- planned ceiling;
- check time;
- generated checkpoint schedule.

If those values drift, reject with `409` as a same-cycle configuration conflict.

V1 supports corrections to **actual usage observations**, not arbitrary mutation of the pacing plan after a cycle has been accepted.

This avoids ambiguous remapping of historical actuals to a changed schedule.

### 17.3 What makes a snapshot newer

Do not trust:

- workbook file modification time;
- XLSX metadata;
- `max_actual_date`;
- client clock.

For a same-cycle accepted history:

```text
newer snapshot = later server accepted created_at
```

Before accepting a new same-cycle snapshot, compare it with the latest accepted snapshot for that cycle and apply Sections 16 and 17.2.

A different raw SHA with semantically unchanged authoritative content may still be accepted as a new immutable snapshot; it changes provenance/history, not tracker metrics.

Exact raw SHA duplicates are handled separately and do not create a second accepted snapshot.

### 17.4 Active dashboard cycle

Choose active cycle by:

```text
tracking_start DESC
created_at DESC
```

among accepted snapshots.

Therefore uploading an older cycle after a newer cycle does not replace the active dashboard cycle.

Within the same latest cycle, the newest accepted snapshot by `created_at` is active.

---

## 18. Formula handling and diagnostics

The app does not trust workbook formulas.

Authoritative inputs:

- baseline;
- tracking start;
- reset;
- hard limit;
- reserve;
- check time;
- entered actual usage.

Application-derived values:

- expected checkpoints;
- planned ceiling;
- checkpoint ceilings;
- status;
- headroom;
- freshness.

### 18.1 Cached formula comparison

When a cached workbook numeric result is available for a derived field, compare it with the application value.

Use an absolute fraction tolerance of:

```text
1e-6
```

unless implementation evidence shows the workbook requires a tighter equally deterministic tolerance.

A mismatch does **not** replace the app value.

### 18.2 Surface mismatches

Formula mismatches must be visible in:

- import API response;
- post-import UI result;
- import history/detail for the accepted snapshot.

Suggested warning:

```text
Workbook formula cache differs from Token Observatory calculations in 2 cells.
Token Observatory calculations are being used.
```

The normalized snapshot stores:

```text
formulaMismatchCount
bounded mismatch details
```

Diagnostics are warning-only unless a mismatch reveals that an authoritative source input itself is malformed.

---

## 19. XLSX security preflight

Treat `.xlsx` as an untrusted ZIP container.

Before normal workbook parsing:

1. enforce multipart request limit;
2. enforce compressed file limit;
3. verify ZIP/OOXML signature and required package structure;
4. reject unsafe/path-traversal entries;
5. reject encrypted content;
6. reject macro/VBA content;
7. bound ZIP entry count;
8. bound single-entry decompressed size;
9. bound total decompressed size.

Target application limits:

```text
max XLSX file size:             8 MiB
max multipart request size:    10 MiB
max ZIP entries:               256
max single uncompressed entry: 16 MiB
max total uncompressed size:   32 MiB
```

### 19.1 Deployment limit requirement

The implementation must verify that the deployed Next.js/Vercel request-body limit can actually support the selected multipart/file limits.

If the hosting/runtime limit is lower, reduce application constants to the effective supported limit and document the final values.

Do not advertise an 8 MiB file limit if the production runtime cannot receive it.

### 19.2 Runtime

Workbook parsing must run server-side in a Node.js-compatible route runtime.

Do not move XLSX parsing to the browser or expose privileged storage access.

### 19.3 Package requirements

Any direct workbook/ZIP parsing dependency must:

- be justified;
- be pinned to an exact reviewed version;
- be documented in the PR;
- be covered by package/lockfile verification consistent with repository policy.

Malformed/unsupported workbooks return controlled `422`, not `500`.

A renamed arbitrary file must not pass `.xlsx` validation.

---

## 20. Import persistence model

Use a dedicated OpenCode Go import table/domain.

Do not reuse ccusage `imports`.

Recommended table:

```sql
create table opencode_go_imports (
  id uuid primary key default gen_random_uuid(),

  status text not null,

  duplicate_of_import_id uuid
    references opencode_go_imports(id)
    on delete set null,

  storage_path text,

  filename text not null,
  file_size_bytes bigint not null,
  raw_sha256 text not null,

  tracking_start timestamptz,
  reset_at timestamptz,
  check_time time,

  baseline_usage numeric,
  hard_limit numeric,
  safety_reserve numeric,
  planned_ceiling numeric,

  latest_actual_usage numeric,
  latest_actual_date date,

  parsed_snapshot jsonb,

  formula_mismatch_count integer not null default 0,

  imported_by uuid,
  error_message text,

  created_at timestamptz not null default now(),
  processed_at timestamptz
);
```

Exact types/checks may be tightened during implementation.

### 20.1 Statuses

At minimum:

```text
processing
processed
exact_duplicate
failed
```

`processed` rows are accepted immutable snapshots.

`exact_duplicate` rows may be retained as audit attempts but must not create a second accepted snapshot or raw object.

### 20.2 Required constraints

Add checks for:

- valid status;
- positive/valid file size;
- SHA-256 format;
- non-negative formula mismatch count;
- processed rows having required normalized fields;
- plan ranges from Section 6;
- reset after tracking start.

### 20.3 Exact raw dedupe

Use a partial uniqueness rule equivalent to:

```text
raw_sha256 unique among active/processed canonical OpenCode Go imports
```

so a concurrent identical upload cannot produce multiple accepted snapshots.

Exact duplicate attempts may reference:

```text
duplicate_of_import_id
```

### 20.4 Storage bucket

Create a dedicated private bucket:

```text
opencode-go-imports
```

Do not use ccusage `raw-imports`.

Recommended storage path:

```text
<import-id>/<safe-filename>
```

### 20.5 Security

- RLS enabled;
- no anon/authenticated direct table grants;
- no browser-role raw Storage access;
- server-only privileged Supabase client after auth + allowlist;
- no signed raw workbook download is required in V1.

---

## 21. Migration naming

Do **not** hardcode a migration sequence in the spec.

At implementation time:

1. inspect the current `supabase/migrations` chain;
2. create the next forward migration using repository naming conventions;
3. never rename or modify an already-applied migration merely to preserve a presumed sequence.

Recommended descriptive suffix:

```text
_opencode_go_tracker.sql
```

This matters because other work may land before this feature.

---

## 22. Import API

Add:

```text
POST /api/opencode-go/import
```

### 22.1 Required flow

```text
request
  ↓
configuration check
  ↓
authentication
  ↓
observatory allowlist authorization
  ↓
same-origin mutation check
  ↓
effective request-size bound
  ↓
multipart parse
  ↓
file validation
  ↓
XLSX ZIP security preflight
  ↓
SHA-256
  ↓
exact duplicate check
  ↓
strict workbook parse
  ↓
expected schedule generation + exact schedule validation
  ↓
semantic validation
  ↓
application pacing recalculation
  ↓
formula diagnostics
  ↓
same-cycle lookup
  ↓
plan-stability + history-regression checks
  ↓
create processing import record
  ↓
private raw Storage upload
  ↓
finalize immutable processed snapshot
  ↓
response summary
```

The exact transaction boundaries may be adjusted to fit Supabase/Postgres safely, but accepted snapshot promotion must not leave partially canonical data.

### 22.2 Error responses

Use predictable JSON responses:

```text
400 malformed request metadata
401 unauthenticated
403 unauthorized / cross-origin
409 same-cycle conflict / history regression / active duplicate race
413 request or file too large
422 invalid or unsupported workbook
500 unexpected Storage/DB failure
503 telemetry/Supabase not configured
```

Do not leak secrets or raw internal Supabase errors.

---

## 23. Storage failure and orphan behavior

### 23.1 Storage upload failure

If the DB import attempt exists but Storage upload fails:

- mark the attempt `failed`;
- store a bounded error message;
- return generic `500`;
- no processed snapshot becomes current.

### 23.2 DB finalization failure after Storage upload

Perform best-effort deletion of the newly uploaded object.

Log structured server-side information containing:

- import ID;
- storage path;
- cleanup attempted;
- cleanup succeeded/failed.

Do not log credentials or raw workbook contents.

If cleanup also fails:

- the object remains private;
- it is not canonical;
- it must not appear in dashboard queries;
- the orphan is acceptable only as a transient operational artifact;
- no automatic orphan-reaper is required in V1.

Operational cleanup may remove it later.

---

## 24. Query layer

Add server-only helpers under:

```text
lib/opencode-go/queries.ts
```

Required reads:

- active/latest tracker snapshot;
- latest accepted snapshot for a specific cycle;
- import history;
- latest active cycle.

### 24.1 Active snapshot ordering

```text
tracking_start DESC
created_at DESC
```

Only `processed` accepted snapshots participate.

A late upload of an old cycle must never replace a newer cycle.

Do not query privileged telemetry directly from client components.

---

## 25. UI and navigation

Update navigation to:

```text
Overview
OpenCode Go
Imports
Machines
```

Route:

```text
/opencode-go
```

The global shell subtitle may change from:

```text
ccusage telemetry
```

to:

```text
usage telemetry
```

or another neutral phrase.

### 25.1 Copy audit

Audit product-level shell/navigation copy for assumptions that Token Observatory is ccusage-only.

Do not remove accurate ccusage wording from pages/features that are specifically about ccusage.

The goal is:

- global product shell = neutral;
- ccusage-specific pages = explicitly ccusage where correct;
- OpenCode Go page = explicitly OpenCode Go.

---

## 26. OpenCode Go page

### 26.1 Hero/status

Visually dominant status:

```text
ON TRACK
NEAR LIMIT
OVER PACE
LIMIT EXCEEDED
UPDATE DUE
RESET REQUIRED
```

Status must not rely on color alone.

### 26.2 Core metrics

Show as applicable:

- recorded usage;
- relevant checkpoint ceiling;
- headroom / amount over pace;
- remaining monthly budget;
- reset timestamp;
- days/time remaining;
- last recorded checkpoint;
- freshness;
- source qualifier (`checkpoint` or `baseline`).

When stale, label:

```text
Last recorded usage
```

not:

```text
Current usage
```

### 26.3 Pace bar

Show actual/last recorded point versus relevant target while respecting freshness labeling.

Do not represent stale data as a verified current point.

### 26.4 Planned-versus-actual chart

Show:

- planned checkpoint ceiling series;
- recorded actual series.

Prefer existing primitives or a small SVG over a heavyweight chart dependency unless a dependency is clearly justified.

#### Accessibility

If the checkpoint table exposes equivalent information, the visual chart may be:

```text
aria-hidden="true"
```

and treated as decorative.

If the chart gains unique interactive information, it must instead provide accessible names/descriptions.

### 26.5 Checkpoint table

Columns:

```text
Date
Ceiling
Actual
Status
Headroom
```

Rules:

- blank actual displays as missing;
- explicit `0%` displays as `0%`;
- historical rows remain visible;
- stale current required row must clearly show update due.

### 26.6 Upload panel

Simple drag/drop or file chooser for `.xlsx`.

After successful import:

- show import result;
- show formula warning if present;
- refresh tracker data without requiring manual navigation.

### 26.7 Import history

Show OpenCode Go import attempts separately from ccusage imports.

Minimum fields:

- import time;
- filename;
- cycle;
- status;
- duplicate state;
- duplicate target where applicable;
- latest recorded actual date/value;
- formula warning count.

---

## 27. Empty/loading/error states

### 27.1 Empty

```text
No OpenCode Go tracker imported yet.
Upload your monthly tracker to start pacing.
```

### 27.2 Loading

Use existing Token Observatory loading language/styles.

### 27.3 Unsupported workbook

Example:

```text
Unsupported OpenCode Go tracker format.
Expected the "Monthly Tracker" sheet and V1 tracker labels.
```

### 27.4 UPDATE_DUE CTA

```text
Upload today's tracker
```

### 27.5 RESET_REQUIRED CTA

```text
Upload the new cycle tracker
```

### 27.6 Formula mismatch

Example:

```text
Workbook formulas differ from Token Observatory calculations.
Token Observatory calculations are being used.
```

---

## 28. No delete / un-import in V1

V1 intentionally has no user-facing:

- delete;
- soft delete;
- tombstone;
- rollback import.

If a recorded actual needs correction:

- upload a newer valid same-cycle snapshot.

If a previously non-null actual disappears:

- reject as regression.

If the cycle plan itself is wrong after acceptance:

- V1 does not support changing the structural plan in place.

This limitation must be documented.

Do not add deletion complexity to V1.

---

## 29. Suggested code structure

```text
app/
  opencode-go/
    page.tsx
    loading.tsx

  api/
    opencode-go/
      import/
        route.ts

components/
  opencode-go/
    tracker-dashboard.tsx
    tracker-upload.tsx
    tracker-status.tsx
    checkpoint-table.tsx
    pace-chart.tsx
    import-history.tsx

lib/
  opencode-go/
    types.ts
    parser.ts
    xlsx-security.ts
    calculations.ts
    status.ts
    queries.ts

supabase/
  migrations/
    <next-repo-migration>_opencode_go_tracker.sql

tests/
  opencode-go.test.ts
```

Minor naming changes are acceptable when repository conventions justify them.

---

## 30. Test fixture policy

Do not depend on a private user workbook being committed to the repository.

Create a **deterministic sanitized fixture generator** checked into the repository.

Requirements:

- deterministic output or deterministic semantic content;
- no private paths/usernames/account details;
- reproduces the supported V1 workbook shape;
- reproduces the reference cycle;
- can generate valid and invalid variants for tests;
- CI can recreate fixtures without external network access.

If the actual provided workbook is proven non-sensitive and deliberately committed, the deterministic sanitized generator is still preferred for malformed/security variants.

---

## 31. Test requirements

V1 is not complete without automated parser, calculation, status, import, security, ordering, and isolation tests.

### 31.1 Reference workbook contract

Prove:

- required sheet/title parse;
- baseline `4.8%`;
- tracking start `2026-08-30 22:29`;
- reset `2026-09-29 11:29`;
- hard limit `100%`;
- reserve `0%`;
- expected schedule contains 29 checkpoints;
- first is Aug 31 12:00;
- last is Sep 28 12:00;
- Sep 5 ceiling recomputes to approximately `22.7278%`;
- reference actuals are null.

### 31.2 Schedule generation

Test:

- partial first day excluded when checkpoint is before tracking start;
- first-day checkpoint included if checkpoint is after tracking start;
- reset-day checkpoint excluded when after reset;
- reset-day checkpoint included if before reset;
- missing checkpoint rejected;
- extra checkpoint rejected;
- wrong checkpoint time rejected;
- non-contiguous day number rejected.

### 31.3 Latest recorded actual

Test:

- most recent non-null checkpoint wins;
- missing latest required checkpoint falls back to earlier non-null for display only;
- no actuals falls back to baseline;
- fallback never makes stale checkpoint fresh.

### 31.4 Actual parsing

Test:

- blank => null;
- empty string => null;
- explicit `0` => real zero;
- negative rejected;
- non-finite rejected;
- over-100 actual may parse and produce limit status.

### 31.5 Correction semantics

Test:

- null → non-null accepted;
- non-null → lower non-null accepted when resulting sequence remains monotonic;
- non-null → higher non-null accepted when resulting sequence remains monotonic;
- correction rejected if resulting sequence decreases chronologically;
- non-null → null rejected with 409.

### 31.6 Same-cycle semantics

Test:

- same tracking start/reset recognized as same cycle;
- structural plan drift rejected;
- raw-SHA duplicate idempotent;
- different SHA + unchanged semantic content has defined accepted behavior;
- later server-created accepted snapshot becomes active within same cycle;
- later upload of older cycle does not replace newer active cycle.

### 31.7 Clock/freshness

Test:

- server/test-injected `now` determines due checkpoint;
- client-provided time metadata is ignored;
- pre-first-checkpoint behavior;
- `UPDATE_DUE`;
- `RESET_REQUIRED`.

### 31.8 Status

Test:

- ON_TRACK;
- NEAR_LIMIT at absolute 2 pp threshold;
- OVER_PACE;
- LIMIT_EXCEEDED;
- UPDATE_DUE;
- RESET_REQUIRED;
- precedence;
- pre-first qualification.

### 31.9 Formula diagnostics

Test:

- cached matching value => no warning;
- cached mismatch => warning;
- mismatch does not replace app calculation;
- warning appears in API result/history data.

### 31.10 XLSX security

Test:

- oversized request;
- oversized compressed file;
- non-ZIP renamed `.xlsx`;
- malformed ZIP;
- path traversal entry;
- excessive entry count;
- excessive single-entry expansion;
- excessive total expansion;
- encrypted content when fixture tooling supports it;
- macro/VBA content;
- malformed workbook returns `422`, not `500`.

### 31.11 Auth/security

Test:

- unauthenticated rejected;
- unauthorized rejected;
- cross-origin mutation rejected;
- browser client never receives privileged Supabase key;
- raw bucket remains private.

### 31.12 Persistence/import

Test:

- processed accepted snapshot immutable;
- duplicate attempt does not create second accepted snapshot;
- accepted raw stored once;
- Storage failure does not promote snapshot;
- DB-finalization failure triggers cleanup attempt;
- cleanup failure remains noncanonical and is logged.

### 31.13 ccusage isolation

Existing ccusage tests continue passing unchanged in meaning.

Explicitly verify OpenCode Go persistence does not write to:

```text
imports
daily_usage_observations
daily_model_usage_observations
session_usage_observations
cross_machine_daily_dedupe
```

and does not alter semantics of:

```text
v_current_daily_usage
v_current_daily_usage_dedupe
v_current_daily_model_usage
v_current_daily_model_usage_dedupe
process_ccusage_import_v3
cross_machine_daily_dedupe
```

---

## 32. Verification gate

Before the implementation PR is ready:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

All must pass.

Also verify:

- current repository migration chain was inspected before naming the new migration;
- migration applies cleanly;
- private `opencode-go-imports` bucket exists;
- actual deployment request-size behavior matches configured limits;
- `/opencode-go` works at desktop and mobile widths;
- reference/sanitized workbook imports successfully;
- malformed files produce controlled 4xx responses;
- formula mismatches produce warning-only behavior;
- current ccusage totals remain unchanged;
- current ccusage dedupe behavior remains unchanged;
- no unrelated refactor is included.

---

## 33. One branch / one PR execution contract

Implementation must use exactly one dedicated feature branch, recommended:

```text
feat/opencode-go-tracker-v1
```

Create exactly one implementation PR targeting `main`.

The PR contains the complete vertical slice:

- required pinned dependencies;
- parser;
- XLSX security preflight;
- checkpoint generation;
- calculations;
- freshness/status;
- persistence migration;
- private Storage bucket;
- import API;
- server-only queries;
- page/components/navigation;
- deterministic fixtures;
- tests;
- README/architecture documentation.

Do not split V1 into separate database/backend/frontend PRs.

Multiple commits are fine; keep them on the same branch and PR.

Do not merge partial implementation.

---

## 34. PR merge gate

Merge only when:

- every acceptance criterion is satisfied;
- full validation passes;
- migration safety is proven;
- storage security is proven;
- request-size behavior is verified in the actual deployment environment;
- ccusage accounting/dedupe behavior is unchanged;
- no unresolved high-severity review finding remains.

---

## 35. Acceptance criteria

V1 is accepted when all are true:

- [ ] `/opencode-go` exists and is authenticated/allowlisted.
- [ ] Navigation includes `OpenCode Go`.
- [ ] Global product shell no longer incorrectly implies the entire app is ccusage-only.
- [ ] Accurate ccusage-specific wording remains where appropriate.
- [ ] No OpenCode API integration is claimed or implied.
- [ ] Workbook Actual Usage is treated as the V1 recorded observational source.
- [ ] Internal percentage values use fractional representation.
- [ ] Blank actual and explicit zero are distinguished.
- [ ] Expected checkpoint schedule is generated by the explicit local-date algorithm.
- [ ] Reference cycle yields exactly 29 checkpoints.
- [ ] Sep 5 target computes to approximately 22.7278%.
- [ ] Server time is the production freshness authority.
- [ ] `latestRecordedActual` is defined and implemented exactly.
- [ ] Missing latest due actual produces `UPDATE_DUE` even when older actuals exist.
- [ ] Pre-first-checkpoint UI does not fabricate headroom.
- [ ] Corrections may move a prior actual up or down while preserving cumulative chronology.
- [ ] Previously non-null actual cannot silently become null.
- [ ] Same-cycle structural plan drift is rejected.
- [ ] Active cycle ordering is `tracking_start DESC`, then accepted `created_at DESC`.
- [ ] Late upload of older cycle cannot replace newer active cycle.
- [ ] Workbook formula/status cells are not authoritative.
- [ ] Formula cache mismatch is surfaced as a warning.
- [ ] User can upload supported `.xlsx`.
- [ ] XLSX security preflight runs before normal parsing.
- [ ] Effective deployment body limits match configured limits.
- [ ] Accepted raw workbook is private in `opencode-go-imports`.
- [ ] Accepted normalized snapshots are immutable.
- [ ] Exact raw re-upload is idempotent.
- [ ] Import history exposes accepted/duplicate/failed state appropriately.
- [ ] Storage cleanup is attempted and logged when DB finalization fails.
- [ ] No user-facing delete/tombstone workflow exists in V1.
- [ ] Dashboard shows status, recorded usage, target, headroom when valid, budget, reset, freshness, chart, and checkpoint history.
- [ ] Chart accessibility is handled explicitly.
- [ ] OpenCode Go import history is visible separately from ccusage imports.
- [ ] Malformed workbook returns controlled 4xx, not accidental 500.
- [ ] Deterministic sanitized fixture generation exists.
- [ ] Existing ccusage tests continue passing.
- [ ] OpenCode Go writes do not touch canonical ccusage telemetry tables.
- [ ] `npm ci`, lint, typecheck, tests, and production build pass.
- [ ] Feature ships through one branch and one PR.

---

## 36. Real product examples

### 36.1 Update due

At Sep 5 14:29:

```text
Sep 3 actual = 15.0%
Sep 4 actual = 18.0%
Sep 5 actual = blank
Sep 5 planned ceiling = 22.73%
```

UI:

```text
OPEN CODE GO

UPDATE DUE
Today's checkpoint was due at 12:00

Last recorded usage
18.0%
Sep 4 checkpoint

Today's planned ceiling
22.73%

Upload today's tracker
```

Do not show a verified Sep 5 headroom number.

### 36.2 On track

```text
Sep 5 actual = 18.2%
Sep 5 ceiling = 22.73%
```

UI:

```text
ON TRACK

Recorded usage
18.2%

Today's ceiling
22.73%

Headroom
+4.53 pp

Budget remaining
81.8%
```

### 36.3 Near limit

```text
Sep 5 actual = 21.7%
```

UI:

```text
NEAR LIMIT

Recorded usage
21.7%

Today's ceiling
22.73%

Headroom
+1.03 pp
```

### 36.4 Over pace

```text
Sep 5 actual = 27.4%
```

UI:

```text
OVER PACE

Recorded usage
27.4%

Today's ceiling
22.73%

Over target
+4.67 pp
```

### 36.5 Correction

Previous accepted snapshot:

```text
Sep 3 = 15%
Sep 4 = 20%
```

New workbook:

```text
Sep 3 = 15%
Sep 4 = 18%
Sep 5 = 21%
```

Accept.

The new sequence is still cumulative/non-decreasing.

Previous immutable snapshot remains in history.

### 36.6 Invalid correction

```text
Sep 3 = 19%
Sep 4 = 17.5%
```

Reject.

The resulting cumulative series decreases.

### 36.7 Reset

At or after:

```text
Sep 29 11:29
```

UI:

```text
RESET REQUIRED

This tracker belongs to the previous cycle.

Upload the new cycle tracker
```

---

## 37. Future V1.1 candidates

After V1 is proven:

### 37.1 Adaptive pace

Keep original plan as a fixed reference and calculate a new recommended pace from the latest fresh actual through reset.

### 37.2 Direct OpenCode source

If OpenCode later exposes a reliable supported usage API:

```text
OpenCode usage source
      ↓
Token Observatory
```

could become the primary observation path, with workbook upload retained as fallback/import history.

This is explicitly not V1.

### 37.3 Reminder automation

Checkpoint reminders or stale-data alerts may be added separately after the core tracker is trusted.

---

## 38. Reviewer resolution matrix

This revision resolves the critical review as follows.

| Review item | Resolution |
|---|---|
| Latest known actual ambiguous | Defined `latestRecordedActual` as most recent non-null checkpoint, else baseline |
| Correction vs monotonicity conflict | Cross-import corrections allowed up/down; resulting accepted sequence must remain chronologically non-decreasing; null regression forbidden |
| Checkpoint derivation incomplete | Exact local-date candidate algorithm defined with strict `trackingStart < candidate < resetAt` |
| `now` source unclear | Production uses server `Date.now()` / UTC instant converted to Africa/Casablanca; client time ignored |
| NEAR_LIMIT absolute threshold | Explicitly absolute 2 pp by design; V1.1 may revisit |
| Baseline before first checkpoint | Explicit pre-first UI contract; no fabricated headroom |
| Same-cycle "newer" unclear | Server accepted `created_at` is ordering authority after same-cycle validation; max actual/file metadata not authoritative |
| Storage cleanup under-specified | Best-effort delete + structured logging + private noncanonical orphan semantics defined |
| Latest cycle selection ambiguous | `tracking_start DESC`, then accepted `created_at DESC` |
| Formula mismatch unused | Warning surfaced in API/UI/history; app values remain authoritative |
| Percentage representation mixed | Internal fractional scale explicitly defined |
| Blank vs explicit zero | Blank/empty => null; explicit zero => real observation |
| Chart accessibility | Decorative when table is equivalent; otherwise accessible description required |
| Navigation copy | Product shell audited for global ccusage-only language; specific ccusage copy retained where accurate |
| Migration name collision | Determine next migration at implementation time; no hardcoded sequence |
| Fixture reproducibility | Deterministic sanitized fixture generator required |
| Request-size mismatch | Effective deployed runtime limit must be verified and constants aligned |
| No delete/tombstone | Explicitly intentional V1 limitation |

---

## 39. Final product principle

The application must not answer:

> What cells are in my spreadsheet?

It must answer:

> Is my latest required OpenCode Go checkpoint actually recorded, am I on pace based on that recorded observation, and how much verified room remains before reset?

The workbook is the V1 observation/input contract.

Token Observatory is the calculation, freshness, history, and operational decision layer.

No direct OpenCode API source is part of V1.
