# Token Observatory

A Next.js + Supabase telemetry application for aggregating ccusage token
consumption across several development machines without double-counting overlapping snapshots or proven cross-machine mirrors.

## V1 behavior

- Register stable machine identities.
- Generate a pinned ccusage daily JSON export with per-agent and model breakdowns.
- Upload the JSON manually.
- Preserve accepted raw files in a private Supabase Storage bucket.
- Reject exact duplicate raw datasets by SHA-256 within the same machine.
- Treat byte-identical exports across machines as strong provenance evidence and
  suppress only daily rows whose token counters also match.
- Collect immutable session fingerprints and use them as a second, conservative
  cross-machine mirror signal. Partial overlap is warning-only.
- Permit only one active import per machine; stale processing imports are recovered
  automatically.
- Strictly decode UTF-8, reject future-dated telemetry, and require every per-agent
  token category plus ccusage's top-level daily totals to reconcile before promotion.
- Compare each machine × agent × date with the current accepted observation.
- Insert immutable new/revised/removal observation versions, including tombstones
  when an agent or an entire previously-observed day disappears inside the covered
  overlap.
- Keep revision identity per import so a state can safely change A → B → A.
- Preserve full per-machine truth while excluding only proven mirrored daily rows
  from the all-machines dashboard.
- Recommend the next collection command from the latest processed import scope,
  with a three-day overlap.
- Restrict server-side telemetry access to an explicit email allowlist.

## Supported collection contract

First import:

```bash
npx ccusage@20.0.20 daily --sections daily,session --by-agent --breakdown --timezone Africa/Casablanca --json > ccusage.json
```

Later imports use the command shown by the application. It adds `--since` with
a three-calendar-day overlap.

## Supabase setup

1. Create a dedicated Supabase project.
2. Copy `.env.example` to `.env.local`.
3. Configure:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `TOKEN_OBSERVATORY_ALLOWED_EMAILS`
4. Disable new-user signups in the dedicated Supabase Auth project, then create
   the allowed user account(s) administratively. The application also redirects
   all signup UI routes back to login.
5. Apply the committed Supabase migrations in order:

```
supabase/migrations/20260829_001_ccusage_v1.sql
supabase/migrations/20260829_002_collection_state.sql
supabase/migrations/20260830_003_model_telemetry.sql
supabase/migrations/20260830_004_cross_machine_session_dedupe.sql
supabase/migrations/20260830_005_cross_machine_dedupe_indexes.sql
supabase/migrations/20260905_006_recovered_monthly_usage.sql
supabase/migrations/20260905_007_recovered_additive_accounting.sql
supabase/migrations/20260905_008_opencode_go_tracker.sql
supabase/migrations/20260905_009_opencode_go_immutable_snapshots.sql
supabase/migrations/20260905_010_opencode_go_upload_limit.sql
supabase/migrations/20260905_011_opencode_go_cycle_processing_guard.sql
```

The migrations create:

- `machines`
- `imports`
- `daily_usage_observations`
- `v_current_daily_usage`
- `v_machine_collection_state`
- `daily_model_usage_observations`
- `v_current_daily_model_usage`
- `session_usage_observations`
- `cross_machine_daily_dedupe`
- `v_current_daily_usage_dedupe`
- `v_current_daily_model_usage_dedupe`
- `v_machine_session_evidence_state`
- `process_ccusage_import(...)`
- `process_ccusage_import_v2(...)`
- `backfill_ccusage_models(...)`
- `backfill_ccusage_sessions(...)`
- `process_ccusage_import_v3(...)`
- private Storage bucket `raw-imports`
- per-machine active-raw-hash dedupe and one-processing-import-per-machine guards
- `recovered_usage_sets` and `recovered_monthly_usage` for preserved historical evidence
- `opencode_go_imports` for immutable OpenCode Go tracker snapshots
- private Storage bucket `opencode-go-imports` for raw OpenCode Go workbooks
- a one-processing-import-per-cycle guard so same-cycle history validation cannot race

Telemetry tables are server-only in V1: RLS is enabled and browser roles have
no grants. The secret/service-role credential is never exposed to the browser.
Mutation APIs distinguish 401/403, reject cross-site browser requests, and bound
request/file metadata before parsing.

## Recovered monthly evidence

The Windows PC that produced the May–August 2026 `ccusage monthly` report is
permanently lost. The terminal output is therefore the highest surviving
granularity: exact monthly aggregates by agent. No daily, session, or per-model
token history was reconstructed.

The recovered report is stored as one additive recovery set with
`source_machine_count = 1`, `suspected_mirror = false`, and
`accounting_mode = additive_recovered`. It belongs to a different physical
machine than the VM's canonical import. Recovery rows live only in
`recovered_usage_sets` and `recovered_monthly_usage`; they are not inserted
into canonical daily, model, session, import, or cross-machine dedupe tables.
The dashboard's server-side unified analytics projection adds this monthly
total to canonical telemetry without redefining canonical views. It merges
machine, month, agent, token-component, and reported-cost dimensions; it keeps
day, week, session, and per-model token attribution unavailable for recovered
history.

The preserved set totals 9,666,290,902 tokens. Together with the VM's canonical
8,204,457,186 tokens, the unified dashboard total is 17,870,748,088 tokens. Its reported
$1,386.19 cost is informational and potentially incomplete because
`laguna-s-2.1-free` and `ox-alpha-free` had missing pricing warnings. The raw
terminal report is stored with the recovery set as surviving evidence.

Direct dependency versions and CI actions are pinned to reviewed versions/commit
SHAs. Next.js responses disable the powered-by header and apply baseline frame,
content-type, referrer, opener, permissions, and CSP restrictions.

## Development

```bash
npm install
npm run dev
```

Validation:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for ingestion invariants and
dedupe rules.

## Deferred deliberately

Projects, canonical model mapping, pricing provenance, and ambiguous partial
cross-machine mirrors remain deferred. Session evidence is intentionally
conservative: it can prove a mirror only when exact daily token content also
matches; otherwise the data stays counted and is flagged for review.


## Model telemetry

Exports generated with `--breakdown` preserve ccusage's per-model token and
cost attribution. Model observations are revisioned independently at
`machine × agent × model × day`, while headline totals continue to use the
canonical agent/day view. This prevents model enrichment from changing or
double-counting the certified token total.

Existing processed imports can be enriched from their private raw Storage object
through the authenticated `POST /api/models/backfill` route. The operation is
idempotent and only inserts missing model observations.


## Cross-machine mirror protection

Session evidence is stored at `machine × agent × session` as hashes plus token
and activity metadata. Raw project paths are used only when deriving a local-key
hash and are not persisted in the session evidence row.

Global suppression requires exact daily token equality with another current
machine row. For non-byte-identical exports, it additionally requires at least two
exact matching session fingerprints with at least 80% overlap for that agent.
Session overlap by itself never subtracts token totals because a session can span
multiple calendar days.

Machine-filtered dashboard views always show the complete local machine truth.
Only the all-machines view excludes rows proven to be mirrors.

Processed imports created before session telemetry can be enriched from their
private raw Storage object via `POST /api/sessions/backfill`. This inserts
evidence only and never re-adds canonical usage.

## OpenCode Go Tracker

`/opencode-go` tracks OpenCode Go monthly-usage pacing against a fixed
subscription-cycle plan. It is a separate telemetry domain from ccusage: it
never reads or writes ccusage or recovered tables, and it never feeds the
unified token dashboard.

V1 input is the uploaded OpenCode Go monthly tracker `.xlsx`. The entered
`Actual Usage` values are recorded observations — there is no OpenCode
provider API, sync, scraping, or credential storage in V1, and the UI never
claims live or provider-verified usage.

- Cycle/checkpoint math uses `Africa/Casablanca`; freshness uses server time.
- The application recomputes checkpoint ceilings, headroom, budget remaining,
  freshness, and status; workbook formulas are warning-only diagnostics.
- Statuses: `RESET_REQUIRED` → `LIMIT_EXCEEDED` → `UPDATE_DUE` → `OVER_PACE`
  → `NEAR_LIMIT` (within 2 percentage points) → `ON_TRACK`.
- Accepted snapshots in `opencode_go_imports` are immutable. Corrections
  arrive as newer same-cycle uploads: previously recorded actuals may move up
  or down while the full sequence stays non-decreasing, but non-null values
  may never become blank and the cycle plan is frozen after first acceptance.
- Same-cycle uploads are serialized while processing so a concurrent workbook
  cannot validate against stale accepted history and then supersede a newer snapshot.
- Exact raw re-uploads are idempotent by SHA-256 (`exact_duplicate`).
- Raw workbooks stay private in the `opencode-go-imports` bucket; there is no
  user-facing delete in V1.
- Effective production upload limits are 4 MiB per `.xlsx` and 4.25 MiB for
  the multipart request, leaving 256 KiB for multipart framing below Vercel's
  4.5 MB Function payload cap. ZIP preflight still limits archives to 256
  entries, 16 MiB per decompressed entry, and 32 MiB total decompressed.
- Workbook parsing currently uses exactly pinned `xlsx@0.18.5`, the last
  version published to the npm registry. That registry release has known
  prototype-pollution and ReDoS advisories (GHSA-4r6h-8v6p-xvw6,
  GHSA-5pgg-2g8v-p4x9). Patched SheetJS CE releases exist from SheetJS's own
  distribution channel, but not from the npm registry. V1 records this as an
  explicit accepted dependency risk while the repository keeps its
  registry-signature verification policy. Mitigations include a dependency-free
  ZIP preflight with bounded entry counts/decompression before `XLSX.read`,
  macro/encryption/traversal rejection, authenticated allowlisted uploads, and
  server-only parsing. Replacing or vendoring the parser should remain a
  follow-up security task rather than being treated as a nonexistent fix.

See `docs/specs/2026-09-05-opencode-go-tracker-v1.md` for the full contract.