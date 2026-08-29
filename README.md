# Token Observatory

A Next.js + Supabase telemetry application for aggregating ccusage token
consumption across several development machines without double-counting overlapping snapshots within each registered machine.

## V1 behavior

- Register stable machine identities.
- Generate a pinned ccusage daily JSON export with per-agent and model breakdowns.
- Upload the JSON manually.
- Preserve accepted raw files in a private Supabase Storage bucket.
- Reject exact duplicate raw datasets by SHA-256 within the same machine.
- Flag byte-identical exports seen on another machine without assuming they are
  the same underlying usage event.
- Permit only one active import per machine; stale processing imports are recovered
  automatically.
- Strictly decode UTF-8, reject future-dated telemetry, and require every per-agent
  token category plus ccusage's top-level daily totals to reconcile before promotion.
- Compare each machine × agent × date with the current accepted observation.
- Insert immutable new/revised/removal observation versions, including tombstones
  when an agent or an entire previously-observed day disappears inside the covered
  overlap.
- Keep revision identity per import so a state can safely change A → B → A.
- Derive the dashboard exclusively from the latest processed observation.
- Recommend the next collection command from the latest processed import scope,
  with a three-day overlap.
- Restrict server-side telemetry access to an explicit email allowlist.

## Supported collection contract

First import:

```bash
npx ccusage@20.0.20 daily --by-agent --breakdown --timezone Africa/Casablanca --json > ccusage.json
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
```

The migrations create:

- `machines`
- `imports`
- `daily_usage_observations`
- `v_current_daily_usage`
- `v_machine_collection_state`
- `daily_model_usage_observations`
- `v_current_daily_model_usage`
- `process_ccusage_import(...)`
- `process_ccusage_import_v2(...)`
- `backfill_ccusage_models(...)`
- private Storage bucket `raw-imports`
- per-machine active-raw-hash dedupe and one-processing-import-per-machine guards

Telemetry tables are server-only in V1: RLS is enabled and browser roles have
no grants. The secret/service-role credential is never exposed to the browser.
Mutation APIs distinguish 401/403, reject cross-site browser requests, and bound
request/file metadata before parsing.

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

Sessions, projects, canonical model mapping, pricing provenance, and semantic
mirror/fork detection for *non-identical* exports are future layers. Raw
`--breakdown` files are retained so those dimensions can be backfilled.


## Model telemetry

Exports generated with `--breakdown` preserve ccusage's per-model token and
cost attribution. Model observations are revisioned independently at
`machine × agent × model × day`, while headline totals continue to use the
canonical agent/day view. This prevents model enrichment from changing or
double-counting the certified token total.

Existing processed imports can be enriched from their private raw Storage object
through the authenticated `POST /api/models/backfill` route. The operation is
idempotent and only inserts missing model observations.
