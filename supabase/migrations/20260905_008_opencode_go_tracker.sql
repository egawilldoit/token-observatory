-- OpenCode Go Tracker V1 persistence.
--
-- Dedicated domain. This migration must NOT touch ccusage tables
-- (imports, daily_usage_observations, daily_model_usage_observations,
-- session_usage_observations, cross_machine_daily_dedupe), recovered tables
-- (recovered_usage_sets, recovered_monthly_usage), their views, or
-- process_ccusage_import_v3.
--
-- Accepted snapshots are immutable history: corrections arrive as newer
-- processed rows, never as UPDATEs of prior accepted rows.

create table if not exists public.opencode_go_imports (
  id uuid primary key default gen_random_uuid(),

  status text not null,

  duplicate_of_import_id uuid
    references public.opencode_go_imports(id)
    on delete set null,

  storage_path text,

  filename text not null,
  file_size_bytes bigint not null,
  raw_sha256 text not null,

  tracking_start timestamptz,
  reset_at timestamptz,
  check_time time,

  baseline_usage numeric,
  hard_limit numeric,
  safety_reserve numeric,
  planned_ceiling numeric,

  latest_actual_usage numeric,
  latest_actual_date date,

  parsed_snapshot jsonb,

  formula_mismatch_count integer not null default 0,
  formula_warnings jsonb not null default '[]'::jsonb,

  imported_by uuid,
  error_message text,

  created_at timestamptz not null default now(),
  processed_at timestamptz,

  constraint opencode_go_imports_status_check check (
    status in ('processing', 'processed', 'exact_duplicate', 'failed')
  ),
  constraint opencode_go_imports_file_size_check check (
    file_size_bytes >= 1
    and file_size_bytes <= 8388608
  ),
  constraint opencode_go_imports_sha_check check (
    raw_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint opencode_go_imports_mismatch_check check (
    formula_mismatch_count >= 0
  ),
  constraint opencode_go_imports_plan_check check (
    (
      baseline_usage is null
      and hard_limit is null
      and safety_reserve is null
      and planned_ceiling is null
    )
    or (
      hard_limit is not null
      and hard_limit > 0
      and safety_reserve is not null
      and safety_reserve >= 0
      and safety_reserve < hard_limit
      and planned_ceiling is not null
      -- Epsilon, not exact equality: the application computes the ceiling in
      -- binary floating point (e.g. 1 - 0.1), while numeric subtraction here
      -- is exact decimal. Exact equality would reject truthful inserts.
      and abs(planned_ceiling - (hard_limit - safety_reserve)) < 0.000000001
      and baseline_usage is not null
      and baseline_usage >= 0
      and baseline_usage <= planned_ceiling
    )
  ),
  constraint opencode_go_imports_cycle_check check (
    tracking_start is null
    or reset_at is null
    or reset_at > tracking_start
  ),
  constraint opencode_go_imports_processed_check check (
    status <> 'processed'
    or (
      tracking_start is not null
      and reset_at is not null
      and check_time is not null
      and baseline_usage is not null
      and hard_limit is not null
      and safety_reserve is not null
      and planned_ceiling is not null
      and parsed_snapshot is not null
      and processed_at is not null
    )
  )
);

-- Exact raw SHA duplicates cannot produce two canonical snapshots, including
-- under concurrent identical uploads.
create unique index if not exists opencode_go_imports_raw_sha_active_uniq
  on public.opencode_go_imports (raw_sha256)
  where status in ('processing', 'processed');

-- Active dashboard cycle ordering: tracking_start DESC, created_at DESC.
create index if not exists opencode_go_imports_active_cycle_idx
  on public.opencode_go_imports (tracking_start desc, created_at desc)
  where status = 'processed';

create index if not exists opencode_go_imports_history_idx
  on public.opencode_go_imports (status, created_at desc);

alter table public.opencode_go_imports enable row level security;

revoke all on table public.opencode_go_imports from anon, authenticated;

grant all on table public.opencode_go_imports to service_role;

-- Private raw workbook bucket. No public access, no browser grants, no
-- signed-download feature in V1. Browser roles receive no storage policies.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'opencode-go-imports',
  'opencode-go-imports',
  false,
  8388608,
  array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
