create table if not exists public.recovered_usage_sets (
  id text primary key,
  description text not null,
  source_type text not null,
  source_machine_count integer not null,
  suspected_mirror boolean not null,
  accounting_mode text not null,
  confidence text not null,
  granularity text not null,
  total_input_tokens bigint not null,
  total_output_tokens bigint not null,
  total_cache_creation_tokens bigint not null,
  total_cache_read_tokens bigint not null,
  total_tokens bigint not null,
  reported_cost_usd numeric,
  pricing_complete boolean not null,
  warnings jsonb not null default '[]'::jsonb,
  raw_terminal_text text not null,
  created_at timestamptz not null default now(),
  constraint recovered_usage_set_source_type_check check (
    source_type = 'terminal_ccusage_monthly'
  ),
  constraint recovered_usage_set_machine_count_check check (
    source_machine_count > 0
  ),
  constraint recovered_usage_set_accounting_mode_check check (
    accounting_mode = 'evidence_only_non_additive'
  ),
  constraint recovered_usage_set_confidence_check check (
    confidence = 'exact_monthly_aggregate'
  ),
  constraint recovered_usage_set_granularity_check check (
    granularity = 'monthly_agent'
  ),
  constraint recovered_usage_set_tokens_nonnegative check (
    total_input_tokens >= 0
    and total_output_tokens >= 0
    and total_cache_creation_tokens >= 0
    and total_cache_read_tokens >= 0
    and total_tokens >= 0
  ),
  constraint recovered_usage_set_total_reconciles check (
    total_tokens = total_input_tokens
      + total_output_tokens
      + total_cache_creation_tokens
      + total_cache_read_tokens
  ),
  constraint recovered_usage_set_cost_nonnegative check (
    reported_cost_usd is null or reported_cost_usd >= 0
  ),
  constraint recovered_usage_set_warnings_array check (
    jsonb_typeof(warnings) = 'array'
  )
);

create table if not exists public.recovered_monthly_usage (
  id text primary key,
  recovery_set_id text not null
    references public.recovered_usage_sets(id) on delete restrict,
  month date not null,
  agent text not null,
  input_tokens bigint not null,
  output_tokens bigint not null,
  cache_creation_tokens bigint not null,
  cache_read_tokens bigint not null,
  total_tokens bigint not null,
  reported_cost_usd numeric,
  models text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  constraint recovered_monthly_usage_month_normalized check (
    month = date_trunc('month', month)::date
  ),
  constraint recovered_monthly_usage_agent_nonempty check (
    length(trim(agent)) between 1 and 128
  ),
  constraint recovered_monthly_usage_tokens_nonnegative check (
    input_tokens >= 0
    and output_tokens >= 0
    and cache_creation_tokens >= 0
    and cache_read_tokens >= 0
    and total_tokens >= 0
  ),
  constraint recovered_monthly_usage_total_reconciles check (
    total_tokens = input_tokens
      + output_tokens
      + cache_creation_tokens
      + cache_read_tokens
  ),
  constraint recovered_monthly_usage_cost_nonnegative check (
    reported_cost_usd is null or reported_cost_usd >= 0
  ),
  constraint recovered_monthly_usage_models_names check (
    array_position(models, '') is null
    and array_position(models, null) is null
  ),
  unique(recovery_set_id, month, agent)
);

create index if not exists recovered_monthly_usage_set_month_idx
  on public.recovered_monthly_usage(recovery_set_id, month);

alter table public.recovered_usage_sets enable row level security;
alter table public.recovered_monthly_usage enable row level security;

revoke all on table public.recovered_usage_sets from anon, authenticated;
revoke all on table public.recovered_monthly_usage from anon, authenticated;

grant all on table public.recovered_usage_sets to service_role;
grant all on table public.recovered_monthly_usage to service_role;
