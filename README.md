# Token Observatory

A Next.js + Supabase telemetry application for aggregating ccusage token
consumption across several development machines without double-counting
overlapping snapshots or exact duplicate datasets.

## V1 behavior

- Register stable machine identities.
- Generate a pinned ccusage daily JSON export with per-agent and model breakdowns.
- Upload the JSON manually.
- Preserve accepted raw files in a private Supabase Storage bucket.
- Reject exact duplicate raw datasets globally by SHA-256, including when the same
  bytes are submitted under a different machine identity.
- Permit only one active import per machine; stale processing imports are recovered
  automatically.
- Validate calendar dates and require per-agent totals to reconcile with ccusage's
  day-level total before promotion.
- Compare each machine × agent × date with the current accepted observation.
- Insert only new/revised observation versions.
- Derive the dashboard exclusively from the latest processed observation.
- Recommend the next collection command with a three-day overlap.
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
4. Create the allowed user account(s) in Supabase Auth. The application does not
   expose public self-sign-up.
5. Apply:

```
supabase/migrations/20260829_001_ccusage_v1.sql
```

The migration creates:

- `machines`
- `imports`
- `daily_usage_observations`
- `v_current_daily_usage`
- `process_ccusage_import(...)`
- private Storage bucket `raw-imports`
- global active-raw-hash dedupe and one-processing-import-per-machine guards

Telemetry tables are server-only in V1: RLS is enabled and browser roles have
no grants. The secret/service-role credential is never exposed to the browser.

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
