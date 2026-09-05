# OpenCode Go Tracker V1 — Product & Engineering Specification

**Repository:** `egawilldoit/token-observatory`  
**Base branch:** `main`  
**Base commit at specification time:** `89df1c8f70c757f124f30b99f5452ed808bb4048`  
**Feature route:** `/opencode-go`  
**Timezone:** `Africa/Casablanca`  
**Status:** Ready for implementation  
**Scope rule:** One implementation branch → one implementation PR

---

## 1. Purpose

Add an **OpenCode Go monthly-usage pacing tracker** to Token Observatory.

The feature accepts the existing OpenCode Go `.xlsx` monthly tracker as an **input format**, normalizes it into application data, recomputes the pacing model in TypeScript, persists immutable import snapshots, and presents a dashboard that answers:

- Am I on track?
- Is today's update missing?
- What is the allowed ceiling for the relevant checkpoint?
- How much headroom remains?
- How much monthly budget remains?
- When does the cycle reset?
- How has actual usage tracked against the planned pace?

This feature belongs in Token Observatory because the repository already provides authenticated telemetry pages, protected mutation APIs, private Supabase storage, import history, SHA-based deduplication patterns, and analytics-oriented UI.

OpenCode Go is a **separate telemetry domain** from ccusage.

---

## 2. Non-negotiable invariants

1. **Do not merge OpenCode Go data into ccusage tables, views, parsers, dedupe logic, or accounting semantics.**
2. **Do not redesign the existing ccusage cross-machine dedupe system.**
3. The workbook is an **import format**, not the application UI.
4. The application must **recompute derived values itself**; workbook formulas and workbook `Status` cells are never authoritative.
5. A stale or missing required checkpoint must never be presented as a confident green state.
6. All cycle/checkpoint calculations use **`Africa/Casablanca`**.
7. Accepted raw workbooks are stored privately and never exposed through public browser storage access.
8. Exact workbook re-uploads are idempotent by SHA-256.
9. Accepted normalized snapshots are immutable import history.
10. The implementation must use the repository's existing authentication, allowlist, same-origin, privileged Supabase, security-header, and server-only telemetry patterns.
11. The implementation must ship in **one dedicated feature branch and one PR**. Do not split V1 across multiple PRs unless a genuine external blocker makes the single-PR contract impossible.

---

## 3. Explicitly out of scope

The following are not part of V1:

- Spreadsheet rendering/editing in the browser.
- Microsoft Excel embedding.
- Automatic OpenCode account/API scraping.
- Automatic collector/scheduler infrastructure.
- Adaptive/rebalanced pacing after over/under-usage.
- Notifications/reminders.
- Multiple workbook templates.
- Project/session/model telemetry.
- Changes to ccusage import behavior.
- Changes to ccusage cross-machine dedupe.
- Canonical model mapping.
- Pricing provenance.
- New machine collection credentials.
- Windows Task Scheduler or Linux systemd integration.

Adaptive pacing is a candidate for **V1.1**, after V1 is proven.

---

## 4. Reference workbook contract

The provided reference workbook is the acceptance fixture for V1 behavior.

### Workbook identity

Required worksheet:

```text
Monthly Tracker
```

Required title:

```text
OpenCode Go — Monthly Usage Tracker
```

### Required input labels

The parser must locate and validate these semantic labels rather than trusting hard-coded coordinates alone:

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

### Required checkpoint headers

```text
Day #
Date
Check Time
Max Monthly Usage
Actual Usage
Status
Headroom
```

### Reference values from the supplied workbook

| Field | Expected value |
|---|---:|
| Baseline/current monthly usage | `0.048` = `4.8%` |
| Tracking starts | `2026-08-30 22:29` local |
| Reset | `2026-09-29 11:29` local |
| Hard monthly limit | `1.0` = `100%` |
| Safety reserve | `0.0` |
| Planned ceiling | `1.0` |
| Remaining starting budget | `0.952` = `95.2 pp` |
| Daily checkpoint time | `12:00` |
| Checkpoint count | `29` |
| First checkpoint | `2026-08-31 12:00` |
| Last checkpoint | `2026-09-28 12:00` |
| Sep 5 checkpoint ceiling | approximately `0.2272776681` = `22.7278%` |

The reference workbook contains no entered `Actual Usage` values.

---

## 5. Domain model

Keep the domain isolated under `lib/opencode-go`.

Recommended core types:

```ts
type OpenCodeGoCheckpoint = {
  day: number;
  date: string; // YYYY-MM-DD in Africa/Casablanca
  checkTime: string; // HH:mm
  ceiling: number; // application-computed fraction, e.g. 0.227
  workbookCeiling?: number | null; // diagnostic only
  actual: number | null;
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

  latestActualUsage: number | null;
  latestActualDate: string | null;

  workbookDiagnostics: {
    formulaValuesAvailable: boolean;
    formulaMismatchCount: number;
  };
};
```

Do not place these types in `lib/ccusage`.

---

## 6. Pacing calculations

### Planned ceiling

```text
plannedCeiling = hardLimit - safetyReserve
```

### Remaining starting budget

```text
remainingStartingBudget = plannedCeiling - baselineUsage
```

### Checkpoint ceiling

For each checkpoint timestamp:

```text
progress =
  (checkpointTimestamp - trackingStartTimestamp)
  /
  (resetTimestamp - trackingStartTimestamp)
```

Then:

```text
ceiling =
  baselineUsage
  +
  (plannedCeiling - baselineUsage) * progress
```

Bound the result:

```text
max(baselineUsage, min(plannedCeiling, ceiling))
```

All timestamps are interpreted as `Africa/Casablanca` wall-clock times.

### Current remaining budget

When a latest actual exists:

```text
budgetRemaining = max(0, plannedCeiling - latestActual)
```

When no actual checkpoint exists:

```text
budgetRemaining = plannedCeiling - baselineUsage
```

The UI must label baseline-derived values clearly and must not imply that baseline is a fresh current reading.

### Headroom

For a fresh required checkpoint:

```text
headroom = requiredCheckpoint.ceiling - requiredCheckpoint.actual
```

Positive means below pace; negative means over pace.

### Average remaining allowance

V1 may show:

```text
(plannedCeiling - latestKnownUsage) / remainingTime
```

only as an informational derived value.

Do not implement adaptive re-planning of future ceilings in V1.

---

## 7. Freshness model

Freshness is a first-class correctness rule.

### Required checkpoint

At a given `now` in `Africa/Casablanca`, the **required checkpoint** is the latest scheduled checkpoint whose timestamp is `<= now` and occurs before reset.

### Fresh

The tracker is fresh when:

- there is no required checkpoint yet; or
- the latest required checkpoint has a non-null `Actual Usage`.

### Update due

The tracker is `UPDATE_DUE` when:

- the cycle has not reset; and
- a required checkpoint exists; and
- that required checkpoint has no actual value.

The application must not infer safety from the old baseline or from an older checkpoint when the latest required checkpoint is missing.

### Important UI rule

When status is `UPDATE_DUE`:

- show the latest recorded value and its timestamp/date;
- show the scheduled ceiling;
- do **not** label the numeric difference as "safe additional usage";
- do **not** present `ON TRACK`;
- primary CTA: **Upload today's tracker**.

Freshness means checkpoint completeness, not continuous live synchronization with OpenCode.

---

## 8. Status model and precedence

Use these V1 statuses:

```ts
type OpenCodeGoStatus =
  | "RESET_REQUIRED"
  | "LIMIT_EXCEEDED"
  | "UPDATE_DUE"
  | "OVER_PACE"
  | "NEAR_LIMIT"
  | "ON_TRACK";
```

### Status precedence

Evaluate in this order:

1. `RESET_REQUIRED`
2. `LIMIT_EXCEEDED`
3. `UPDATE_DUE`
4. `OVER_PACE`
5. `NEAR_LIMIT`
6. `ON_TRACK`

### Rules

#### RESET_REQUIRED

```text
now >= resetAt
```

The previous workbook belongs to an expired cycle.

#### LIMIT_EXCEEDED

Before reset, if the latest known actual is:

```text
actual >= hardLimit
```

This status may supersede freshness because it represents a known hard-limit breach.

#### UPDATE_DUE

Use the freshness rule above.

#### OVER_PACE

For a fresh required checkpoint:

```text
actual > checkpointCeiling
AND
actual < hardLimit
```

#### NEAR_LIMIT

For a fresh required checkpoint:

```text
0 <= headroom <= 0.02
```

V1 uses **2 percentage points** as the near-limit threshold.

#### ON_TRACK

For a fresh required checkpoint:

```text
actual <= checkpointCeiling
AND
headroom > 0.02
```

Before the first required checkpoint, the baseline may be presented as the starting observation and the next planned ceiling may be shown, with copy making clear that the first checkpoint is not yet due.

---

## 9. Reference status acceptance cases

Using the supplied workbook:

### Missing actual on Sep 5 after 12:00

At:

```text
2026-09-05 14:29 Africa/Casablanca
```

with no actuals entered:

```text
status = UPDATE_DUE
latest recorded usage = baseline 4.8%
Sep 5 scheduled ceiling ≈ 22.7278%
```

The page must not say the user is safely `17.9 pp` under plan as a live/current fact.

### Fresh ON TRACK example

If Sep 5 actual is:

```text
18.2%
```

then:

```text
status = ON_TRACK
headroom ≈ +4.53 pp
```

### Fresh NEAR LIMIT example

If Sep 5 actual is:

```text
21.7%
```

then:

```text
status = NEAR_LIMIT
headroom ≈ +1.03 pp
```

### Fresh OVER PACE example

If Sep 5 actual is:

```text
27.4%
```

then:

```text
status = OVER_PACE
over target ≈ 4.67 pp
```

### Hard limit

If latest actual is:

```text
100%
```

then:

```text
status = LIMIT_EXCEEDED
```

### Reset

At or after:

```text
2026-09-29 11:29 Africa/Casablanca
```

the status is:

```text
RESET_REQUIRED
```

---

## 10. Workbook parsing rules

The parser must be strict enough to reject unsupported files without guessing.

### Accept

- `.xlsx` OOXML workbook.
- Required `Monthly Tracker` sheet.
- Required title.
- Required labels/headers.
- Valid numeric percentage inputs.
- Valid Excel date/time cells corresponding to the expected semantic fields.
- Optional blank `Actual Usage` cells.
- Formula cells in derived columns.

### Reject

Return a controlled validation error for:

- missing `Monthly Tracker` sheet;
- incorrect or missing title;
- required labels missing;
- checkpoint headers missing;
- invalid dates/times;
- `trackingStart >= resetAt`;
- non-finite or negative usage values;
- invalid hard limit or safety reserve;
- `plannedCeiling < baselineUsage`;
- duplicate checkpoint dates/timestamps;
- checkpoint timestamps not strictly increasing;
- inconsistent checkpoint times;
- non-contiguous day numbers;
- checkpoint rows outside the cycle;
- missing expected daily checkpoint rows;
- malformed workbook;
- macro-enabled workbook/content;
- encrypted workbook;
- unsafe ZIP paths;
- oversized compressed or decompressed workbook.

### Actual usage validation

Actual values must be finite and non-negative.

Values may equal or exceed the configured hard limit so the application can represent `LIMIT_EXCEEDED`.

Within one workbook cycle, entered actual values must be non-decreasing by checkpoint timestamp because the metric is cumulative monthly usage.

### Formula handling

The application must **not evaluate workbook formulas as source-of-truth logic**.

Authoritative source inputs:

- baseline;
- tracking start;
- reset;
- hard limit;
- reserve;
- checkpoint schedule;
- entered actual usage.

Derived workbook columns are diagnostic only.

If cached workbook formula values are available, compare them to application calculations using a small numeric tolerance. Record mismatch diagnostics. A formula-cache mismatch must never cause the application to use the workbook formula result instead of the TypeScript calculation.

---

## 11. XLSX security preflight

Treat `.xlsx` as an untrusted ZIP container.

Before normal parsing:

1. Enforce multipart/request bounds.
2. Enforce compressed file size.
3. Verify ZIP/OOXML signature and required package structure.
4. Reject path traversal entries.
5. Reject encrypted entries.
6. Reject macro/VBA content.
7. Bound ZIP entry count.
8. Bound single-entry uncompressed size.
9. Bound total uncompressed size.

V1 limits:

```text
max XLSX file size:             8 MiB
max multipart request size:    10 MiB
max ZIP entries:               256
max single uncompressed entry: 16 MiB
max total uncompressed size:   32 MiB
```

The implementation may choose the parsing package, but:

- it must be actively maintained/reviewable;
- the direct version must be pinned exactly;
- package choice must be documented in the PR;
- parsing must run server-side only.

Malformed workbooks return `422`, not `500`.

Renaming arbitrary content to `.xlsx` must not pass validation.

---

## 12. Same-cycle import semantics

An accepted workbook is an immutable snapshot.

### Exact duplicate

```text
same raw SHA-256
```

returns an idempotent duplicate result and does not create a second accepted snapshot or duplicate raw object.

### Newer snapshot in the same cycle

A later workbook for the same cycle may:

- add newly entered actual checkpoints;
- revise a previously entered non-null actual value.

It must not silently regress history by replacing a previously non-null checkpoint with `null`.

If a same-cycle upload removes a previously recorded actual value, reject with a conflict-style response and explain that the workbook would regress accepted checkpoint history.

This protects against accidentally uploading an older local copy.

### New cycle

A workbook with a later valid cycle start/reset is accepted as a new cycle.

The dashboard selects the latest accepted cycle by cycle start/import recency, while preserving previous cycles in import history.

---

## 13. Persistence

Add a dedicated migration:

```text
supabase/migrations/20260905_006_opencode_go_tracker.sql
```

### Table

Recommended table:

```sql
create table opencode_go_imports (
  id uuid primary key default gen_random_uuid(),

  storage_path text not null,
  filename text not null,
  file_size_bytes bigint not null,
  raw_sha256 text not null unique,

  tracking_start timestamptz not null,
  reset_at timestamptz not null,
  check_time time not null,

  baseline_usage numeric not null,
  hard_limit numeric not null,
  safety_reserve numeric not null,
  planned_ceiling numeric not null,

  latest_actual_usage numeric,
  latest_actual_date date,

  parsed_snapshot jsonb not null,

  imported_by uuid,
  created_at timestamptz not null default now()
);
```

Exact column types/check constraints may be tightened during implementation, but the semantic contract must remain.

### Storage bucket

Create a separate private bucket:

```text
opencode-go-imports
```

Do not use the ccusage `raw-imports` bucket.

Storage path should be deterministic/auditable, for example:

```text
<import-id>/<safe-filename>
```

### Security

- RLS enabled.
- No browser-role read/write policies for raw telemetry.
- Data operations use the existing server-side privileged Supabase pattern after auth + allowlist checks.
- Raw workbook objects remain private.
- No signed download URL is required for V1 UI.

---

## 14. Import API

Add:

```text
POST /api/opencode-go/import
```

### Required server flow

```text
request
  -> configuration check
  -> authentication
  -> observatory allowlist authorization
  -> same-origin mutation check
  -> request-size bound
  -> multipart parsing
  -> file presence/type checks
  -> XLSX ZIP security preflight
  -> SHA-256
  -> exact duplicate lookup
  -> strict workbook parse
  -> semantic validation
  -> TypeScript pacing recalculation
  -> same-cycle regression protection
  -> private raw Storage upload
  -> immutable normalized DB insert
  -> response summary
```

If DB persistence fails after Storage upload, perform best-effort cleanup of the newly uploaded raw object so the route does not intentionally leave orphan objects.

### Response classes

Use predictable JSON errors:

```text
400 malformed request metadata
401 unauthenticated
403 unauthorized / cross-origin
409 exact processing/history regression conflict where applicable
413 request/file too large
422 unsupported or invalid workbook
500 unexpected Storage/DB failure
503 telemetry/Supabase not configured
```

Do not leak internal Supabase/service details.

---

## 15. Query layer

Add server-only helpers under:

```text
lib/opencode-go/queries.ts
```

Required reads:

- latest accepted tracker snapshot;
- import history;
- latest cycle;
- previous accepted snapshot for same-cycle regression validation.

Do not query privileged telemetry directly from client components.

---

## 16. UI and navigation

Update primary navigation to:

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

Because the application now covers more than ccusage, change sidebar subtitle from:

```text
ccusage telemetry
```

to a neutral phrase such as:

```text
usage telemetry
```

Do not alter the meaning of existing Overview/Imports/Machines pages.

### OpenCode Go page sections

#### A. Hero/status panel

Primary status must be visually dominant:

```text
ON TRACK
NEAR LIMIT
OVER PACE
LIMIT EXCEEDED
UPDATE DUE
RESET REQUIRED
```

Status must not rely on color alone.

#### B. Core metrics

Show:

- latest recorded/current usage;
- relevant checkpoint ceiling;
- headroom/over-target;
- budget remaining;
- reset date/time;
- time/days remaining;
- last recorded checkpoint;
- freshness label.

When data is stale, use wording such as:

```text
Last recorded usage
```

instead of:

```text
Current usage
```

#### C. Pace bar

Show actual vs target on a 0–planned-limit scale.

#### D. Planned vs actual chart

Show:

- planned checkpoint ceiling line;
- actual checkpoint values.

Do not add a heavyweight chart dependency unless necessary. Prefer existing visual primitives or a small accessible SVG implementation.

The checkpoint table remains the textual equivalent for accessibility.

#### E. Checkpoint table

Columns:

```text
Date
Ceiling
Actual
Status
Headroom
```

Historical rows must remain visible.

#### F. Upload panel

Simple drag/drop/file chooser for `.xlsx`.

After success, refresh the tracker data without requiring manual page navigation.

#### G. Import history

Show recent OpenCode Go imports separately from ccusage imports.

Minimum fields:

- import time;
- filename;
- cycle;
- SHA duplicate state;
- latest actual date/value;
- accepted/duplicate result.

---

## 17. Empty/loading/error states

### No OpenCode Go imports

Show:

```text
No OpenCode Go tracker imported yet.
Upload your monthly tracker to start pacing.
```

### Loading

Use existing Token Observatory loading visual language.

### Unsupported workbook

Show a specific message, for example:

```text
Unsupported OpenCode Go tracker format.
Expected the "Monthly Tracker" sheet and V1 tracker labels.
```

### Update due

CTA:

```text
Upload today's tracker
```

### Reset required

CTA:

```text
Upload the new cycle tracker
```

---

## 18. Suggested code structure

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
    20260905_006_opencode_go_tracker.sql

tests/
  opencode-go.test.ts
```

Minor naming changes are acceptable if repository conventions require them.

---

## 19. Test requirements

V1 is not complete without automated coverage for parser, calculations, statuses, import security, and persistence contract.

### Reference workbook tests

Must prove:

- parses the supplied V1 workbook shape;
- reads baseline `4.8%`;
- reads tracking start `2026-08-30 22:29`;
- reads reset `2026-09-29 11:29`;
- reads hard limit `100%`;
- reads reserve `0%`;
- produces 29 checkpoints;
- first checkpoint is Aug 31;
- last checkpoint is Sep 28;
- recomputes Sep 5 ceiling to approximately `22.7278%`;
- no actual values are present in the reference file.

If the supplied workbook contains private/sensitive information, do not commit it directly. Generate a semantically equivalent sanitized fixture programmatically.

### Parser rejection tests

- missing sheet;
- wrong title;
- missing required input label;
- missing checkpoint header;
- invalid date;
- invalid time;
- invalid limits;
- non-monotonic checkpoint schedule;
- inconsistent check time;
- duplicate checkpoint timestamp;
- negative/non-finite actual;
- decreasing cumulative actual values.

### Status tests

- `UPDATE_DUE` after due checkpoint with no actual;
- `ON_TRACK`;
- `NEAR_LIMIT`;
- `OVER_PACE`;
- `LIMIT_EXCEEDED`;
- `RESET_REQUIRED`;
- status precedence;
- before-first-checkpoint behavior.

### Security tests

- oversized file;
- oversized request;
- non-ZIP renamed `.xlsx`;
- malformed ZIP;
- path traversal entry;
- excessive entry count;
- excessive uncompressed size;
- encrypted entry if supported by fixture tooling;
- macro/VBA content;
- malformed workbook returns `422`, not `500`;
- cross-origin mutation rejected;
- unauthenticated rejected;
- unauthorized rejected.

### Import semantics tests

- exact SHA upload idempotent;
- raw file stored only for accepted non-duplicate upload;
- same-cycle new actual is accepted;
- same-cycle non-null correction is accepted;
- same-cycle actual → null regression is rejected;
- latest snapshot query chooses correct cycle/import.

### Isolation regression

Existing ccusage tests must remain unchanged in meaning and continue passing.

Add an explicit test/verification statement that OpenCode Go persistence does not modify:

```text
imports
daily_usage_observations
daily_model_usage_observations
session_usage_observations
cross_machine_daily_dedupe
```

except through unrelated existing application behavior.

---

## 20. Verification gate

Before the implementation PR is ready to merge:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

All must pass.

Also verify:

- migration applies cleanly to the current schema;
- private Storage bucket exists after migration;
- OpenCode page works at desktop and mobile widths;
- import succeeds with the sanitized/reference workbook;
- malformed upload paths return controlled responses;
- current ccusage dashboard totals are unchanged;
- current ccusage cross-machine dedupe objects and behavior are unchanged.

---

## 21. One branch / one PR execution contract

Implementation must use exactly one dedicated branch, recommended:

```text
feat/opencode-go-tracker-v1
```

Create exactly one implementation PR targeting `main`.

The PR contains the complete V1 vertical slice:

- dependency changes if required;
- parser/security preflight;
- calculations/status;
- migration;
- Storage bucket;
- API;
- queries;
- page/components/navigation;
- tests;
- README/architecture documentation updates.

Do not merge partial implementations to `main`.

Do not open independent backend/frontend/database PRs for this V1.

If work needs multiple commits, keep them on the same feature branch and PR.

### PR merge gate

The PR may merge only when:

- all acceptance criteria in this spec are satisfied;
- required automated verification passes;
- migration safety is confirmed;
- no ccusage accounting/dedupe behavior changed;
- no unresolved high-severity review findings remain.

---

## 22. Acceptance criteria

V1 is accepted when all of the following are true:

- [ ] `/opencode-go` exists and is authenticated/allowlisted.
- [ ] Navigation includes `OpenCode Go`.
- [ ] The ccusage feature remains semantically isolated.
- [ ] User can upload the supported `.xlsx` tracker.
- [ ] XLSX is security-preflighted before parsing.
- [ ] Parser validates the V1 workbook contract strictly.
- [ ] App recomputes planned ceilings in TypeScript.
- [ ] Workbook formula/status cells are not authoritative.
- [ ] Raw accepted workbook is private in `opencode-go-imports`.
- [ ] Normalized accepted snapshot is persisted immutably.
- [ ] Exact SHA re-upload is idempotent.
- [ ] Same-cycle history cannot silently regress actual values to null.
- [ ] Reference workbook yields 29 checkpoints.
- [ ] Sep 5 target computes to ~22.7278%.
- [ ] Missing Sep 5 actual after 12:00 produces `UPDATE_DUE`.
- [ ] Fresh actuals correctly produce `ON_TRACK`, `NEAR_LIMIT`, `OVER_PACE`, or `LIMIT_EXCEEDED`.
- [ ] Expired cycle produces `RESET_REQUIRED`.
- [ ] Stale data is never described as a current safe reading.
- [ ] Dashboard shows target, actual, headroom, budget, reset, freshness, chart, and checkpoint history.
- [ ] OpenCode import history is visible.
- [ ] API uses current auth/allowlist/same-origin/server-only Supabase patterns.
- [ ] Malformed workbook returns controlled 4xx response.
- [ ] Existing ccusage tests continue passing.
- [ ] `npm ci`, lint, typecheck, tests, and production build pass.
- [ ] Feature ships through one feature branch and one PR.

---

## 23. Future V1.1 candidate

After V1 is proven with real daily use, consider **adaptive pace**.

Example:

```text
Original planned target today: 22.7%
Actual today:                  15.0%
Under original plan:           7.7 pp
```

V1.1 may recompute a recommended future daily allowance from the latest actual through reset while preserving the original plan as a fixed reference line.

This must remain separate from V1 acceptance.

---

## 24. Final product principle

The application should not answer:

> What cells are in my spreadsheet?

It should answer:

> Is my latest required OpenCode Go checkpoint recorded, am I on pace, and how much verified room remains before reset?

The spreadsheet is only the ingestion contract. Token Observatory is the operational view.
