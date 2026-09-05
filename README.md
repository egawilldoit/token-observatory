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

Telemetry tables are server-only in V1: RLS is enabled and browser roles have
no grants. The secret/service-role credential is never exposed to the browser.
Mutation APIs distinguish 401/403, reject cross-site browser requests, and bound
request/file metadata before parsing.

## Recovered monthly evidence

The original Windows machines that produced the May–August 2026 `ccusage
monthly` reports are permanently lost. The terminal output is therefore the
highest surviving granularity: exact monthly aggregates by agent. No daily,
session, or per-model token history was reconstructed.

The two surviving reports are stored as one recovery set with
`source_machine_count = 2`, `suspected_mirror = true`, and
`accounting_mode = evidence_only_non_additive`. This records two provenance
sources without counting a possible mirrored history twice. Recovery rows live
only in `recovered_usage_sets` and `recovered_monthly_usage`; they are not
inserted into canonical daily, model, session, import, or cross-machine dedupe
tables and are never silently added to dashboard totals.

The preserved set totals 9,666,290,902 tokens. Its reported $1,386.19 cost is
informational and potentially incomplete because `laguna-s-2.1-free` and
`ox-alpha-free` had missing pricing warnings. The raw terminal reports are
stored with the recovery set as immutable surviving evidence.

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
