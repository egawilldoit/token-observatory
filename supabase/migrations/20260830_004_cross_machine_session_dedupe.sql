create table if not exists public.session_usage_observations (
  id uuid primary key default gen_random_uuid(),
  machine_id text not null references public.machines(id) on delete restrict,
  import_id uuid not null references public.imports(id) on delete restrict,
  agent text not null,
  session_id text not null,
  first_activity timestamptz,
  last_activity timestamptz,
  input_tokens bigint not null check (input_tokens >= 0),
  output_tokens bigint not null check (output_tokens >= 0),
  cache_read_tokens bigint not null check (cache_read_tokens >= 0),
  cache_creation_tokens bigint not null check (cache_creation_tokens >= 0),
  reported_total_tokens bigint not null check (reported_total_tokens >= 0),
  accounting_delta_tokens bigint not null,
  reported_cost_usd numeric,
  models jsonb not null default '[]'::jsonb,
  local_key_hash text not null,
  identity_hash text not null,
  mirror_hash text not null,
  session_hash text not null,
  created_at timestamptz not null default now(),
  constraint session_usage_agent_nonempty check (
    length(trim(agent)) between 1 and 128
  ),
  constraint session_usage_session_nonempty check (
    length(trim(session_id)) between 1 and 512
  ),
  constraint session_usage_activity_order check (
    first_activity is null
    or last_activity is null
    or first_activity <= last_activity
  ),
  constraint session_usage_cost_nonnegative check (
    reported_cost_usd is null or reported_cost_usd >= 0
  ),
  constraint session_usage_models_array check (
    jsonb_typeof(models) = 'array'
  ),
  constraint session_usage_local_hash_format check (
    local_key_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint session_usage_identity_hash_format check (
    identity_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint session_usage_mirror_hash_format check (
    mirror_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint session_usage_hash_format check (
    session_hash ~ '^[0-9a-f]{64}$'
  ),
  unique(import_id, local_key_hash)
);

create index if not exists session_usage_machine_agent_idx
  on public.session_usage_observations(machine_id, agent);

create index if not exists session_usage_identity_idx
  on public.session_usage_observations(identity_hash);

create index if not exists session_usage_mirror_idx
  on public.session_usage_observations(mirror_hash);

create index if not exists session_usage_machine_activity_idx
  on public.session_usage_observations(machine_id, last_activity desc nulls last);

create table if not exists public.cross_machine_daily_dedupe (
  observation_id uuid primary key
    references public.daily_usage_observations(id) on delete cascade,
  canonical_observation_id uuid not null
    references public.daily_usage_observations(id) on delete cascade,
  canonical_machine_id text not null
    references public.machines(id) on delete restrict,
  reason text not null,
  matched_session_count integer not null default 0
    check (matched_session_count >= 0),
  session_overlap_ratio numeric not null default 0
    check (session_overlap_ratio between 0 and 1),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cross_machine_daily_reason_check check (
    reason in (
      'exact_raw_snapshot',
      'exact_daily_with_session_evidence'
    )
  ),
  constraint cross_machine_daily_not_self check (
    observation_id <> canonical_observation_id
  ),
  constraint cross_machine_daily_evidence_object check (
    jsonb_typeof(evidence) = 'object'
  )
);

create index if not exists cross_machine_daily_canonical_idx
  on public.cross_machine_daily_dedupe(canonical_observation_id);

create or replace view public.v_current_daily_usage_dedupe
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
),
current_rows as (
  select *
  from ranked
  where revision_rank = 1
    and not is_tombstone
)
select
  c.id,
  c.machine_id,
  c.import_id,
  c.agent,
  c.usage_date,
  c.input_tokens,
  c.output_tokens,
  c.cache_read_tokens,
  c.cache_creation_tokens,
  c.reported_total_tokens,
  c.accounting_delta_tokens,
  c.reported_cost_usd,
  c.is_tombstone,
  c.usage_hash,
  c.created_at,
  (link.observation_id is not null and canonical.id is not null)
    as global_duplicate,
  case
    when canonical.id is not null then canonical.machine_id
    else null
  end as canonical_machine_id
from current_rows c
left join public.cross_machine_daily_dedupe link
  on link.observation_id = c.id
left join current_rows canonical
  on canonical.id = link.canonical_observation_id;

create or replace view public.v_current_daily_model_usage_dedupe
with (security_invoker = true)
as
select
  model_rows.*,
  coalesce(daily.global_duplicate, false) as global_duplicate,
  daily.canonical_machine_id
from public.v_current_daily_model_usage model_rows
left join public.v_current_daily_usage_dedupe daily
  on daily.machine_id = model_rows.machine_id
 and daily.agent = model_rows.agent
 and daily.usage_date = model_rows.usage_date;

create or replace view public.v_machine_session_evidence_state
with (security_invoker = true)
as
select
  m.id as machine_id,
  count(distinct s.identity_hash)::bigint as session_count,
  count(distinct s.mirror_hash)::bigint as mirror_fingerprint_count,
  max(s.created_at) as last_session_evidence_at
from public.machines m
left join public.session_usage_observations s
  on s.machine_id = m.id
left join public.imports i
  on i.id = s.import_id
 and i.status = 'processed'
where s.id is null or i.id is not null
group by m.id;

create or replace function public.backfill_ccusage_sessions(
  p_import_id uuid,
  p_session_rows jsonb
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
    and status = 'processed';

  if v_machine_id is null then
    raise exception 'Import % is not processed', p_import_id;
  end if;

  insert into public.session_usage_observations (
    machine_id,
    import_id,
    agent,
    session_id,
    first_activity,
    last_activity,
    input_tokens,
    output_tokens,
    cache_read_tokens,
    cache_creation_tokens,
    reported_total_tokens,
    accounting_delta_tokens,
    reported_cost_usd,
    models,
    local_key_hash,
    identity_hash,
    mirror_hash,
    session_hash
  )
  select
    v_machine_id,
    p_import_id,
    x.agent,
    x.session_id,
    x.first_activity,
    x.last_activity,
    x.input_tokens,
    x.output_tokens,
    x.cache_read_tokens,
    x.cache_creation_tokens,
    x.reported_total_tokens,
    x.accounting_delta_tokens,
    x.reported_cost_usd,
    coalesce(x.models, '[]'::jsonb),
    x.local_key_hash,
    x.identity_hash,
    x.mirror_hash,
    x.session_hash
  from jsonb_to_recordset(coalesce(p_session_rows, '[]'::jsonb)) as x(
    agent text,
    session_id text,
    first_activity timestamptz,
    last_activity timestamptz,
    input_tokens bigint,
    output_tokens bigint,
    cache_read_tokens bigint,
    cache_creation_tokens bigint,
    reported_total_tokens bigint,
    accounting_delta_tokens bigint,
    reported_cost_usd numeric,
    models jsonb,
    local_key_hash text,
    identity_hash text,
    mirror_hash text,
    session_hash text
  )
  on conflict (import_id, local_key_hash) do nothing;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'importId', p_import_id,
    'insertedSessionRows', v_inserted
  );
end;
$$;

create or replace function public.process_ccusage_import_v3(
  p_import_id uuid,
  p_rows jsonb,
  p_model_rows jsonb,
  p_session_rows jsonb,
  p_dedupe_links jsonb,
  p_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_machine_id text;
  v_result jsonb;
  v_session_result jsonb;
  v_dedupe_inserted integer := 0;
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

  select public.process_ccusage_import_v2(
    p_import_id,
    p_rows,
    p_model_rows,
    p_summary
  ) into v_result;

  select public.backfill_ccusage_sessions(
    p_import_id,
    p_session_rows
  ) into v_session_result;

  insert into public.cross_machine_daily_dedupe (
    observation_id,
    canonical_observation_id,
    canonical_machine_id,
    reason,
    matched_session_count,
    session_overlap_ratio,
    evidence
  )
  select
    d.id,
    canonical.id,
    canonical.machine_id,
    x.reason,
    x.matched_session_count,
    x.session_overlap_ratio,
    coalesce(x.evidence, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_dedupe_links, '[]'::jsonb)) as x(
    agent text,
    usage_date date,
    canonical_observation_id uuid,
    canonical_machine_id text,
    reason text,
    matched_session_count integer,
    session_overlap_ratio numeric,
    evidence jsonb
  )
  join public.v_current_daily_usage d
    on d.machine_id = v_machine_id
   and d.agent = x.agent
   and d.usage_date = x.usage_date
  join public.daily_usage_observations canonical
    on canonical.id = x.canonical_observation_id
   and canonical.machine_id = x.canonical_machine_id
   and canonical.machine_id <> d.machine_id
   and canonical.agent = d.agent
   and canonical.usage_date = d.usage_date
   and canonical.input_tokens = d.input_tokens
   and canonical.output_tokens = d.output_tokens
   and canonical.cache_read_tokens = d.cache_read_tokens
   and canonical.cache_creation_tokens = d.cache_creation_tokens
   and canonical.reported_total_tokens = d.reported_total_tokens
   and not canonical.is_tombstone
  on conflict (observation_id) do update
  set
    canonical_observation_id = excluded.canonical_observation_id,
    canonical_machine_id = excluded.canonical_machine_id,
    reason = excluded.reason,
    matched_session_count = excluded.matched_session_count,
    session_overlap_ratio = excluded.session_overlap_ratio,
    evidence = excluded.evidence;

  get diagnostics v_dedupe_inserted = row_count;

  update public.imports
  set cross_machine_match =
    coalesce((p_summary ->> 'crossMachineMatch')::boolean, false)
  where id = p_import_id;

  return coalesce(v_result, '{}'::jsonb)
    || coalesce(v_session_result, '{}'::jsonb)
    || jsonb_build_object('dedupeLinks', v_dedupe_inserted);
end;
$$;

alter table public.session_usage_observations enable row level security;
alter table public.cross_machine_daily_dedupe enable row level security;

revoke all on table public.session_usage_observations from anon, authenticated;
revoke all on table public.cross_machine_daily_dedupe from anon, authenticated;
revoke all on table public.v_current_daily_usage_dedupe from anon, authenticated;
revoke all on table public.v_current_daily_model_usage_dedupe from anon, authenticated;
revoke all on table public.v_machine_session_evidence_state from anon, authenticated;
revoke all on function public.backfill_ccusage_sessions(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.process_ccusage_import_v3(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant all on table public.session_usage_observations to service_role;
grant all on table public.cross_machine_daily_dedupe to service_role;
grant select on table public.v_current_daily_usage_dedupe to service_role;
grant select on table public.v_current_daily_model_usage_dedupe to service_role;
grant select on table public.v_machine_session_evidence_state to service_role;
grant execute on function public.backfill_ccusage_sessions(uuid, jsonb)
  to service_role;
grant execute on function public.process_ccusage_import_v3(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) to service_role;
