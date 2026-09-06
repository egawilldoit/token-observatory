-- OpenCode Go Tracker V2: immutable monthly provider observations.
--
-- Three separate truths:
-- - Excel workbook (opencode_go_imports) = MONTHLY SAFE USAGE CONTRACT
-- - OpenCode Go API = REAL CURRENT MONTHLY USAGE (this table)
-- - Token Observatory comparison layer joins them at read time.
--
-- Provider observations are append-only evidence. They MUST NOT mutate the
-- safe contract, and new-cycle observations are never attached to a previous
-- contract: this table carries no contract foreign key by design.
--
-- Timestamp semantics (the OpenCode API supplies no observation timestamp):
-- - observed_at = when the collection request started (closest proxy for
--   the provider state actually read)
-- - fetched_at  = when the upstream response was received
-- Both are set by the server at collection time; neither is provider data.
--
-- Forward-only follow-up to 20260905_012_*. Earlier migrations are untouched.

create table if not exists public.opencode_go_provider_snapshots (
  id uuid primary key default gen_random_uuid(),

  observed_at timestamptz not null default now(),
  fetched_at timestamptz not null default now(),

  monthly_percent numeric not null,
  monthly_status text not null,

  provider_resets_at timestamptz not null,

  source text not null default 'opencode_api',

  fetch_duration_ms integer not null default 0,

  created_at timestamptz not null default now(),

  constraint opencode_go_provider_snapshots_percent_check check (
    monthly_percent >= 0
  ),
  constraint opencode_go_provider_snapshots_status_check check (
    char_length(monthly_status) >= 1 and char_length(monthly_status) <= 64
  ),
  constraint opencode_go_provider_snapshots_source_check check (
    source = 'opencode_api'
  ),
  constraint opencode_go_provider_snapshots_duration_check check (
    fetch_duration_ms >= 0 and fetch_duration_ms <= 600000
  )
);

create index if not exists opencode_go_provider_snapshots_observed_idx
  on public.opencode_go_provider_snapshots (observed_at desc);

create index if not exists opencode_go_provider_snapshots_reset_idx
  on public.opencode_go_provider_snapshots (provider_resets_at desc);

alter table public.opencode_go_provider_snapshots enable row level security;

revoke all on table public.opencode_go_provider_snapshots from anon, authenticated;

grant all on table public.opencode_go_provider_snapshots to service_role;

-- Append-only evidence: accepted provider observations are immutable.
create or replace function public.reject_opencode_go_provider_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Provider observations are append-only (snapshot %)', old.id;
end;
$$;

revoke all on function public.reject_opencode_go_provider_mutation()
  from public, anon, authenticated;

grant execute on function public.reject_opencode_go_provider_mutation()
  to service_role;

drop trigger if exists opencode_go_provider_snapshots_no_mutation
  on public.opencode_go_provider_snapshots;

create trigger opencode_go_provider_snapshots_no_mutation
  before update or delete on public.opencode_go_provider_snapshots
  for each row execute function public.reject_opencode_go_provider_mutation();

alter function public.reject_opencode_go_provider_mutation()
  set search_path = pg_catalog, public;
