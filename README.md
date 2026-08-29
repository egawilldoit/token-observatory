# Token Observatory

A small Next.js + Supabase telemetry application for aggregating ccusage token
consumption across several development machines without double-counting
overlapping snapshots.

## V1 behavior

- Register stable machine identities.
- Generate a pinned ccusage daily JSON export with per-agent and model breakdowns.
- Upload the JSON manually.
- Preserve the raw file in a private Supabase Storage bucket.
- Reject exact same-machine file uploads by SHA-256.
- Compare each machine × agent × date with the current accepted observation.
- Insert only new/revised observation versions.
- Derive the dashboard exclusively from the latest processed observation.
- Recommend the next collection command with a three-day overlap.

## Supported collection contract

First import:

```bash
npx ccusage@20.0.20 daily --by-agent --breakdown --timezone Africa/Casablanca --json > ccusage.json
```

Later imports use the command shown by the application. It adds `--since` with
a three-calendar-day overlap.

## Supabase setup

1. Create a Supabase project.
2. Copy `.env.example` to `.env.local` and configure the public URL/key plus
   a server-only secret key.
3. Apply:

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

Telemetry tables are server-only in V1: RLS is enabled and browser roles have
no grants.

## Development

```bash
npm install
npm run dev
```

Validation:

```bash
npm run lint
npm run typecheck
npm run build
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for ingestion invariants and
dedupe rules.

## Deferred deliberately

Sessions, projects, canonical model mapping, pricing provenance and
cross-machine mirror/fork resolution are future layers. Raw `--breakdown`
files are retained so those dimensions can be backfilled.
