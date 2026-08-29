create extension if not exists pgcrypto;

create table if not exists public.machines (
  id text primary key,
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint machines_id_format check (id ~ '^[a-z0-9][a-z0-9-]{1,63}$')
);

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null references public.machines(id) on delete restrict,
  storage_path text,
  filename text,
  file_size_bytes bigint,
  raw_sha256 text not null,
  ccusage_version text,
  command_used text,
  timezone text not null default 'Africa/Casablanca',
  scope_start date,
  scope_end date,
  status text not null default 'processing',
  duplicate_of_import_id uuid references public.imports(id) on delete set null,
  cross_machine_match boolean not null default false,
  summary jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint imports_status_check check (
    status in ('processing', 'processed', 'exact_duplicate', 'failed')
  ),
  constraint imports_file_size_check check (
    file_size_bytes is null or file_size_bytes between 0 and 8388608
  ),
  constraint imports_hash_format check (raw_sha256 ~ '^[0-9a-f]{64}$'),
  constraint imports_scope_order check (
    scope_start is null or scope_end is null or scope_start <= scope_end
  )
);

create unique index if not exists imports_one_active_hash_per_machine
  on public.imports(machine_id, raw_sha256)
  where status in ('processing', 'processed');

create unique index if not exists imports_one_processing_per_machine
  on public.imports(machine_id)
  where status = 'processing';

create index if not exists imports_machine_created_idx
  on public.imports(machine_id, created_at desc);

create index if not exists imports_hash_idx
  on public.imports(raw_sha256);

create table if not exists public.daily_usage_observations (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null references public.machines(id) on delete restrict,
  import_id uuid not null references public.imports(id) on delete restrict,
  agent text not null,
  usage_date date not null,
  input_tokens bigint not null check (input_tokens >= 0),
  output_tokens bigint not null check (output_tokens >= 0),
  cache_read_tokens bigint not null check (cache_read_tokens >= 0),
  cache_creation_tokens bigint not null check (cache_creation_tokens >= 0),
  reported_total_tokens bigint not null check (reported_total_tokens >= 0),
  accounting_delta_tokens bigint not null,
  reported_cost_usd numeric,
  is_tombstone boolean not null default false,
  usage_hash text not null,
  created_at timestamptz not null default now(),
  constraint daily_usage_agent_nonempty check (length(trim(agent)) > 0),
  constraint daily_usage_hash_format check (usage_hash ~ '^[0-9a-f]{64}$'),
  constraint daily_usage_cost_nonnegative check (
    reported_cost_usd is null or reported_cost_usd >= 0
  ),
  constraint daily_usage_tombstone_zero check (
    not is_tombstone or (
      input_tokens = 0
      and output_tokens = 0
      and cache_read_tokens = 0
      and cache_creation_tokens = 0
      and reported_total_tokens = 0
      and accounting_delta_tokens = 0
      and reported_cost_usd is null
    )
  ),
  unique(import_id, agent, usage_date)
);

create index if not exists daily_usage_content_hash_idx
  on public.daily_usage_observations(
    machine_id,
    agent,
    usage_date,
    usage_hash
  );

create index if not exists daily_usage_machine_date_idx
  on public.daily_usage_observations(machine_id, usage_date desc);

create index if not exists daily_usage_machine_agent_date_idx
  on public.daily_usage_observations(machine_id, agent, usage_date desc);

create or replace view public.v_current_daily_usage
with (security_invoker = true)
as
with ranked as (
  select
    d.id,
    d.machine_id,
    d.import_id,
    d.agent,
    d.usage_date,
    d.input_tokens,
    d.output_tokens,
    d.cache_read_tokens,
    d.cache_creation_tokens,
    d.reported_total_tokens,
    d.accounting_delta_tokens,
    d.reported_cost_usd,
    d.is_tombstone,
    d.usage_hash,
    d.created_at,
    row_number() over (
      partition by d.machine_id, d.agent, d.usage_date
      order by
        i.processed_at desc nulls last,
        d.created_at desc,
        d.id desc
    ) as revision_rank
  from public.daily_usage_observations d
  join public.imports i on i.id = d.import_id
  where i.status = 'processed'
)
select
  id,
  machine_id,
  import_id,
  agent,
  usage_date,
  input_tokens,
  output_tokens,
  cache_read_tokens,
  cache_creation_tokens,
  reported_total_tokens,
  accounting_delta_tokens,
  reported_cost_usd,
  is_tombstone,
  usage_hash,
  created_at
from ranked
where revision_rank = 1
  and not is_tombstone;

create or replace function public.process_ccusage_import(
  p_import_id uuid,
  p_rows jsonb,
  p_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_machine_id text;
  v_inserted integer := 0;
begin
  select machine_id
    into v_machine_id
  from public.imports
  where id = p_import_id
    and status = 'processing'
  for update;

  if v_machine_id is null then
    raise exception 'Import % is not in processing state', p_import_id;
  end if;

  insert into public.daily_usage_observations (
    machine_id,
    import_id,
    agent,
    usage_date,
    input_tokens,
    output_tokens,
    cache_read_tokens,
    cache_creation_tokens,
    reported_total_tokens,
    accounting_delta_tokens,
    reported_cost_usd,
    is_tombstone,
    usage_hash
  )
  select
    v_machine_id,
    p_import_id,
    x.agent,
    x.usage_date,
    x.input_tokens,
    x.output_tokens,
    x.cache_read_tokens,
    x.cache_creation_tokens,
    x.reported_total_tokens,
    x.accounting_delta_tokens,
    x.reported_cost_usd,
    x.is_tombstone,
    x.usage_hash
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x(
    agent text,
    usage_date date,
    input_tokens bigint,
    output_tokens bigint,
    cache_read_tokens bigint,
    cache_creation_tokens bigint,
    reported_total_tokens bigint,
    accounting_delta_tokens bigint,
    reported_cost_usd numeric,
    is_tombstone boolean,
    usage_hash text
  )
  on conflict (import_id, agent, usage_date) do nothing;

  get diagnostics v_inserted = row_count;

  update public.imports
  set
    status = 'processed',
    summary = p_summary,
    error_message = null,
    processed_at = now()
  where id = p_import_id;

  return jsonb_build_object(
    'importId', p_import_id,
    'insertedRows', v_inserted
  );
end;
$$;

alter table public.machines enable row level security;
alter table public.imports enable row level security;
alter table public.daily_usage_observations enable row level security;

revoke all on table public.machines from anon, authenticated;
revoke all on table public.imports from anon, authenticated;
revoke all on table public.daily_usage_observations from anon, authenticated;
revoke all on table public.v_current_daily_usage from anon, authenticated;
revoke all on function public.process_ccusage_import(uuid, jsonb, jsonb)
  from public, anon, authenticated;

grant all on table public.machines to service_role;
grant all on table public.imports to service_role;
grant all on table public.daily_usage_observations to service_role;
grant select on table public.v_current_daily_usage to service_role;
grant execute on function public.process_ccusage_import(uuid, jsonb, jsonb)
  to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'raw-imports',
  'raw-imports',
  false,
  8388608,
  array['application/json']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
