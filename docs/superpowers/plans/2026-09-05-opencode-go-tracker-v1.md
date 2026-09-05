# OpenCode Go Tracker V1 — Implementation Plan

**Date:** 2026-09-05
**Branch:** `feat/opencode-go-tracker-v1`
**Base:** `origin/main` @ `8f160f23b3c5f9a356610329a11160df47646308` (verify at execution; rebase only by fast-forward if main moved)
**Spec:** `docs/specs/2026-09-05-opencode-go-tracker-v1.md` (supplied final, NOT stale PR #12)
**Worktree:** `/tmp/opencode-go-tracker-v1` (deviation from preferred `.worktrees/…` because `.worktrees` is NOT gitignored on current main; sibling `/tmp` worktree avoids polluting the repo; all work still isolated on `feat/opencode-go-tracker-v1`)

## 0. Non-negotiables

- OpenCode Go is a NEW, SEPARATE domain. Never write/read `imports`, `daily_usage_observations`, `daily_model_usage_observations`, `session_usage_observations`, `cross_machine_daily_dedupe`, `recovered_usage_sets`, `recovered_monthly_usage`. Never alter `v_current_daily_usage*`, `process_ccusage_import_v3`.
- Dashboard unified total must still reconcile to 17,870,748,088 (canonical 8,204,457,186 + recovered 9,666,290,902) unless legitimate new ccusage telemetry arrived; prove isolation.
- Production freshness uses server `Date.now()` → UTC instant → Africa/Casablanca boundaries. Never client `now`, never workbook mtime, never XLSX metadata.
- Internal fractions 0–1. Blank actual = null, explicit 0 = 0. Workbook formulas are warning-only.
- One branch, one PR (`feat: add OpenCode Go Tracker V1`, base `main`), do NOT merge. Push after every logical commit. Draft early, keep pushing.

## 1. Architecture

### 1.1 Domain boundaries

```text
lib/opencode-go/
  types.ts            # OpenCodeGoCheckpoint, FormulaWarning, TrackerSnapshot, Status, ParsedWorkbook, ImportSemantics types
  time.ts             # Africa/Casablanca wall-clock ↔ UTC instant helpers (Intl-based, no dep)
  schedule.ts         # checkpoint generation: local-date enumeration, strict (trackingStart, resetAt) bounds, Day# 1..N
  calculations.ts     # plannedCeiling, remainingStartingBudget, checkpoint ceiling interpolation, latestRecordedActual, budgetRemaining, headroom
  status.ts           # requiredCheckpoint, freshness (UPDATE_DUE/pre-first), 6-state precedence, pre-first qualifier
  xlsx-security.ts    # untrusted-ZIP preflight: signature, entry count/size bounds, traversal, encryption, VBA/macro signals (no new dep: manual central-directory parse)
  parser.ts           # strict semantic workbook parse via `xlsx@0.18.5` (pinned, exact); never trusts formula cells as truth
  formula.ts          # cached-formula vs app recomputation at 1e-6 absolute tolerance; warning-only
  import-semantics.ts # cycle identity, plan freeze, correction/monotonic/null-regression rules, active-cycle ordering, SHA idempotency helpers (pure, DB-free)
  config.ts           # limits, bucket name, status literals, error codes
  fixtures.ts         # deterministic sanitized .xlsx generator (uses `xlsx` lib; no network; valid + invalid variants)
  queries.ts          # server-only Supabase helpers (`import "server-only"`): active snapshot, cycle snapshot, history
```

### 1.2 API / persistence

```text
supabase/migrations/20260905_008_opencode_go_tracker.sql  # opencode_go_imports + indexes + RLS (no grants to anon/authenticated); bucket created via dashboard/SQL note
app/api/opencode-go/import/route.ts                        # POST /api/opencode-go/import, Node runtime, order: config→auth→allowlist→same-origin→size→multipart→preflight→SHA→dupe→parse→schedule→validate→recompute→diagnostics→same-cycle→processing row→storage→finalize→response
```

Flow mirrors `app/api/imports/route.ts` infrastructure patterns (auth, allowlist, same-origin, multipart guard, admin client, private storage, safe filenames, SHA-256) but ZERO ccusage business logic reuse.

### 1.3 UI

```text
app/opencode-go/page.tsx        # server component: auth+allowlist gate, server now, active snapshot via queries.ts, passes to client dashboard
app/opencode-go/loading.tsx     # existing loading language
components/opencode-go/
  tracker-dashboard.tsx         # hero status + metrics + pace bar + chart + table + upload + history composition
  tracker-status.tsx            # status hero (text, not color-only)
  checkpoint-table.tsx          # accessible table (Date/Ceiling/Actual/Status/Headroom)
  pace-chart.tsx                # lightweight SVG planned-vs-actual, aria-hidden when table equivalent
  tracker-upload.tsx            # .xlsx chooser/drop, upload state, duplicate/failure/formula-warning display
  import-history.tsx            # OpenCode Go history separate from ccusage imports
components/telemetry/app-shell.tsx  # add "OpenCode Go" nav (Overview/OpenCode Go/Imports/Machines), subtitle "usage telemetry"
```

No OpenCode API client, no scraping, no credentials, no polling, no delete/tombstone UI.

## 2. Exact files expected

### Create

- `docs/specs/2026-09-05-opencode-go-tracker-v1.md` (done — supplied final)
- `docs/superpowers/plans/2026-09-05-opencode-go-tracker-v1.md` (this file)
- `lib/opencode-go/types.ts`, `time.ts`, `schedule.ts`, `calculations.ts`, `status.ts`, `xlsx-security.ts`, `parser.ts`, `formula.ts`, `import-semantics.ts`, `config.ts`, `fixtures.ts`, `queries.ts`
- `supabase/migrations/20260905_008_opencode_go_tracker.sql` (next sequence; verify dir at migration time — 006/007 exist; NEVER edit them)
- `app/api/opencode-go/import/route.ts`
- `app/opencode-go/page.tsx`, `app/opencode-go/loading.tsx`
- `components/opencode-go/tracker-dashboard.tsx`, `tracker-status.tsx`, `checkpoint-table.tsx`, `pace-chart.tsx`, `tracker-upload.tsx`, `import-history.tsx`
- `tests/opencode-go.test.ts` (single entry per repo `npm test` glob `tests/*.test.ts`; keep all OpenCode Go coverage here to avoid glob changes)
- docs updates: `README.md` (OpenCode Go section), `docs/ARCHITECTURE.md` (OpenCode Go domain appendix)

### Modify

- `package.json` + `package-lock.json`: add EXACT pinned `xlsx@0.18.5` (justified: OOXML parse incl. sharedStrings/styles/dates/formula cache; preflight stays dep-free manual ZIP parse; documented in PR)
- `components/telemetry/app-shell.tsx`: nav + neutral subtitle
- `app/dashboard/page.tsx` (only if global copy audit needs it — no ccusage semantic change)

### Never touch

- `lib/ccusage/*`, `lib/recovery/*`, `lib/telemetry/*` semantics; `supabase/migrations/20260829_*`, `20260830_*`, `20260905_006_*`, `20260905_007_*`; ccusage views/RPC; stale `spec/opencode-go-tracker-v1` branch.

## 3. Timezone design (Africa/Casablanca)

- `time.ts` provides: `casablancaParts(instant)`, `casablancaWallToInstant(date, hhmm)` via offset search (format the candidate UTC in Casablanca, adjust until wall matches; bounded ±3 iterations; Morocco DST handled by Intl), `addLocalDays`, `localDateList(startDate, endDate)`.
- All schedule math in real instants (ms) derived from wall times. Tests inject `now: number`; route/page pass `Date.now()`.
- Reference: trackingStart 2026-08-30 22:29 → instant; reset 2026-09-29 11:29; check 12:00; expect 29 checkpoints Aug31–Sep28; Sep5 ceiling ≈ 0.2272776681.

## 4. Test-first sequence (TDD, RED→GREEN per commit)

1. `types` + `time` + `schedule` — reference contract (29, first/last, boundaries, contiguous Day#). Tests: partial-first exclusion, reset-day exclusion/inclusion, missing/extra/wrong-time/non-contiguous rejection (at semantic level).
2. `calculations` — baseline/plannedCeiling/remaining budget/interpolation/latestRecordedActual/budgetRemaining/headroom/null-vs-zero/pre-first (no headroom). Sep5 ≈ 0.2272776681.
3. `status` — all 6 states, exact precedence, 2pp absolute NEAR_LIMIT, pre-first qualifier, LIMIT_EXCEEDED ⊃ UPDATE_DUE, RESET_REQUIRED at >= resetAt.
4. `fixtures` — deterministic generator: valid, blank-actual, explicit-zero, malformed-schedule, duplicate-checkpoint, missing-checkpoint, non-monotonic, renamed-non-xlsx, malformed-archive, macro/VBA-signal, formula-mismatch. Assert deterministic bytes or deterministic semantic content + no network.
5. `xlsx-security` — 8MiB file / 10MiB multipart / ≤256 entries / ≤16MiB single / ≤32MiB total; traversal, encryption, VBA (`vbaProject.bin`, `xl/vba*`, `xl/macros*`, `vbaData.xml`), OOXML required parts (`[Content_Types].xml`, `xl/workbook.xml`), non-ZIP rename, malformed ZIP → controlled errors (never throw 500).
6. `parser` — required sheet/title/labels/headers, numeric plan validation, Excel date/time cells, blank→null vs 0→0, monotonic-in-snapshot check, percentage fractions, schedule-exact match → 422 taxonomy.
7. `formula` — 1e-6 tolerance, mismatch warning-only, bounded details persisted.
8. Migration `008` — table, checks, partial unique SHA, RLS enabled + no anon/auth grants, works on fresh chain (apply migrations 001→008 in order on scratch Postgres or `supabase db` lint if available; else SQL review + `psql` syntax check).
9. `queries` — active ordering `tracking_start DESC, created_at DESC`, processed-only, old-cycle never replaces new (mocked admin client).
10. `import-semantics` — exact-duplicate idempotency, drift 409, null-regression 409, monotonic 422/409 per spec, server-created ordering.
11. Route `POST /api/opencode-go/import` — full order + error codes 400/401/403/409/413/422/500/503; no raw error leak; storage-failure → failed; DB-finalize-failure → best-effort delete + structured log (importId/path/attempted/ok).
12. UI — nav, `/opencode-go` shell, hero/status, metrics, pace bar, SVG chart (aria-hidden w/ table), table, upload, history, empty/loading/error states, UPDATE_DUE/RESET_REQUIRED CTAs, formula warning copy; responsive + recorded-usage wording (no live/sync claims).
13. Hardening — auth/allowlist/same-origin/limits/traversal/VBA/dupe/drift/correction/monotonic/cleanup/ordering/old-vs-new/formula/isolation.
14. Docs — README + ARCHITECTURE appendix + deployment-limit note.

## 5. Migration / storage work

- Filename: `supabase/migrations/20260905_008_opencode_go_tracker.sql` (confirm no newer migration landed at execution; else take next sequence).
- Table `opencode_go_imports` per spec §20 (uuid PK, status check, duplicate FK `ON DELETE SET NULL`, storage_path nullable, filename/size/sha, tracking_start/reset_at/check_time, baseline/hard/reserve/planned numeric, latest_actual_usage/date, parsed_snapshot jsonb, formula_mismatch_count default 0, imported_by uuid, error_message, created_at default now(), processed_at).
- Checks: status ∈ (processing,processed,exact_duplicate,failed); file_size 1..8388608; sha `^[0-9a-f]{64}$`; mismatch ≥ 0; processed ⇒ tracking_start/reset_at/baseline/hard/planned/parsed_snapshot NOT NULL; hard > 0; reserve ≥ 0 < hard; baseline 0..planned; reset > tracking_start.
- Partial unique: `UNIQUE (raw_sha256) WHERE status IN ('processing','processed')` (concurrency-safe exact-dupe; race returns 409).
- Indexes: `(tracking_start DESC, created_at DESC)` for active cycle; `(status, created_at)` for history.
- RLS: `ENABLE ROW LEVEL SECURITY`, `REVOKE ALL ON opencode_go_imports FROM anon, authenticated`, no policies (service-role only). Bucket `opencode-go-imports` private (`public = false`), no anon/auth storage policies.
- Fresh-chain verification: apply 001→008 in order on empty Postgres (CI has no live DB; use `pg-mem`? No — do static ordering check + `psql --dry`? Minimal: `node -e` SQL parse + manual chain test if `supabase` CLI present; else document + verify in production project before apply).

## 6. API work

Route `app/api/opencode-go/import/route.ts` (`export const runtime = "nodejs"`):
config → `getObservatoryAccess` (401/403) → `isCrossOriginRequest` (403) → `requestExceedsBytes(10MiB)` (413) → `formData` (400) → file presence/size 1..8MiB (400/413) → `Buffer.from(await file.arrayBuffer())` → `preflightXlsxSecurity(buffer, {filename, size})` (422/413) → `sha256` → duplicate check (`processing`→409, `processed`→ audit `exact_duplicate` row, no storage, return idempotent) → `parseOpenCodeGoWorkbook(buffer)` (422) → generate expected schedule + exact-match validation (422) → recompute ceilings + latestRecordedActual + formula diagnostics → same-cycle lookup (latest processed same tracking_start/reset_at) → plan-freeze 409 + null-regression 409 + monotonic 422 → insert `processing` row (handle unique-race → 409) → storage upload `opencode-go-imports/<id>/<safe>` (fail → mark failed 500) → finalize `processed` w/ parsed_snapshot (fail → best-effort storage.remove + structured `console.error(JSON.stringify({importId, storagePath, cleanupAttempted: true, cleanupOk}))` + mark failed 500) → JSON summary `{status, importId, cycle, latestRecorded, formulaWarnings, duplicateOf?}`.
Never leak `error.message` from Supabase/parser verbatim beyond safe allowlist; map to controlled codes.

## 7. UI work

- `app-shell.tsx`: nav `[Overview→/dashboard, OpenCode Go→/opencode-go, Imports→/imports, Machines→/machines]`; subtitle `usage telemetry`.
- `/opencode-go` server page: `getObservatoryAccess` gate (redirect login/unauthorized), `Date.now()` server now, `getActiveOpenCodeGoSnapshot()` + `listOpenCodeGoImports(50)` via admin client; pass serialized snapshot + now to `tracker-dashboard`.
- Dashboard: hero status text (`UPDATE DUE` etc. + qualifier), recorded/last-recorded usage + source, relevant ceiling, headroom/over-pace (fresh only), budget remaining, reset timestamp + countdown, freshness line, pace bar (no stale-as-current), SVG chart + full table, upload panel, history.
- Copy: `Recorded usage`, `Last recorded usage`, `Upload today's tracker`, `Upload the new cycle tracker`, formula warning `Workbook formulas differ from Token Observatory calculations. Token Observatory calculations are being used.` Empty: `No OpenCode Go tracker imported yet. Upload your monthly tracker to start pacing.`

## 8. Security work

- Reuse `isCrossOriginRequest`, `requestExceedsBytes`, `decodeUtf8Strict`-style strictness, `getObservatoryAccess`, `createAdminClient`, `safeFilename`, SHA-256.
- XLSX preflight before `xlsx` parse; traversal (`..`, absolute, drive-letter, backslash-escape), encryption (`EncryptionInfo`, `EncryptedPackage`), VBA/macro parts + `vbaProject.bin` + `xl/vbaProjectSignature*` + content-type overrides, entry/size bombs.
- Deployment limits: Next/Vercel — App Router `formData()` buffers in memory; Vercel serverless request payload cap is ~4.5 MB on Hobby (Pro larger). Code enforces spec targets (8 MiB file / 10 MiB request) AND documents effective production ceiling in `lib/opencode-go/config.ts` comment + README + PR body: if Vercel Hobby, files > ~4.5 MB will be rejected upstream before app 413. Do not advertise 8 MiB as guaranteed on Hobby.
- `xlsx@0.18.5` exact pin, justification + lockfile verification (`npm audit signatures`), `export const runtime = "nodejs"`.

## 9. Production verification

- Supabase project identity: prove Token Observatory project (ref/name) before ANY mutation; NEVER touch Ega-House-Platform; if only Ega-House connector available → code/PR only, record migration as blocked.
- Before/after: capture canonical/recovered/unified totals via existing queries; OpenCode Go migration touches only new table + new bucket.
- After apply: table/index/constraints/RLS/no-anon-auth/storage-private/service-path checks.
- Fresh-chain: migrations apply 001→008 in order on scratch DB.

## 10. Final acceptance matrix (maps to spec §35)

Route/nav/shell-copy/no-API-claims/fractions/blank-vs-zero/schedule-algorithm/29-checkpoints/Sep5≈22.7278%/server-time/latestRecordedActual/UPDATE_DUE/pre-first-no-headroom/corrections/null-regression/drift-409/ordering/old-cycle-no-replace/formula-warning/upload/preflight/limits/private-bucket/immutable/idempotent/history/cleanup/no-delete/dashboard/chart-a11y/separate-history/4xx/fixtures/ccusage-tests-green/no-ccusage-writes/5-gates/one-branch-one-PR — each gets at least one test or manual proof + checkbox in PR body.

## 11. Commit plan (one logical unit each, push each)

1. `docs: sync final OpenCode Go Tracker V1 specification` (this spec file)
2. `docs: add OpenCode Go V1 implementation plan` (this plan)
3. `feat: add OpenCode Go cycle and checkpoint domain` (types/time/schedule + tests)
4. `feat: add OpenCode Go pacing calculations` (+ tests incl. Sep5)
5. `feat: add OpenCode Go freshness and status model` (+ tests all 6 + precedence)
6. `test: add deterministic OpenCode Go workbook fixtures` (fixtures + xlsx dep pin)
7. `feat: add secure OpenCode Go XLSX preflight` (+ security tests)
8. `feat: add OpenCode Go workbook parser` (+ parser tests)
9. `feat: add OpenCode Go formula diagnostics` (+ tests)
10. `feat: add OpenCode Go persistence` (migration 008)
11. `feat: add OpenCode Go query layer` (+ ordering tests)
12. `feat: add OpenCode Go import semantics` (+ correction/dupe/drift tests)
13. `feat: add OpenCode Go import API` (route + integration tests w/ mocked Supabase)
14. `feat: add OpenCode Go route and navigation` (page shell + nav)
15. `feat: add OpenCode Go tracker dashboard` (hero/metrics)
16. `feat: add OpenCode Go pacing history` (chart + table)
17. `feat: add OpenCode Go upload and history` (upload + history panels)
18. `test: harden OpenCode Go V1 integration` (auth/security/isolation sweep)
19. `docs: document OpenCode Go Tracker V1` (README + ARCHITECTURE)

Then: full gates, one PR (draft → ready, NOT merged), CI/Vercel/CodeRabbit loop, final report.
