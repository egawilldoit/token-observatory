-- OpenCode Go Tracker V2 hardening: atomic snapshot append + percent contract.
--
-- 1. DB percent contract: monthly_percent is a normalized fraction 0..1.
--    OpenCode /usage reports an official quota percentage; exhaustion is
--    100% (fraction 1) or a rate-limited status, so values above 1 have no
--    meaning and are rejected. This replaces the previous >= 0 check.
--
-- 2. Atomic append (concurrency fix): manual refresh and cron both ran
--    read -> decide -> insert as separate operations, so concurrent callers
--    could read the same latest row and append duplicates. The function
--    below takes a transaction-scoped advisory lock, re-reads the latest
--    snapshot inside the lock, enforces the cooldown/append rule there, and
--    inserts at most once. Callers use it when present and keep the legacy
--    read-decide-insert path only as a pre-migration fallback.
--
-- Forward-only follow-up to 20260906_013_*. Earlier migrations are untouched.

alter table public.opencode_go_provider_snapshots
  drop constraint if exists opencode_go_provider_snapshots_percent_check;

alter table public.opencode_go_provider_snapshots
  add constraint opencode_go_provider_snapshots_percent_check
  check (monthly_percent >= 0 and monthly_percent <= 1);

-- Atomic, idempotent append of one provider observation.
--
-- Parameters mirror the application append rule:
--   p_cooldown_ms        backend refresh cooldown (skip when a fresh
--                        observation already exists)
--   p_max_age_ms         snapshot rule (>1h since last observation stores)
--   p_reset_tolerance_ms same reset window tolerance (jitter never stores)
--
-- Returns jsonb: {"stored": bool, "snapshot": row}.
create or replace function public.append_opencode_go_provider_snapshot(
  p_monthly_percent numeric,
  p_monthly_status text,
  p_provider_resets_at timestamptz,
  p_fetch_duration_ms integer,
  p_observed_at timestamptz,
  p_fetched_at timestamptz,
  p_cooldown_ms bigint,
  p_max_age_ms bigint,
  p_reset_tolerance_ms bigint
)
returns jsonb
language plpgsql
as $$
declare
  v_prev public.opencode_go_provider_snapshots%rowtype;
  v_next public.opencode_go_provider_snapshots%rowtype;
  v_stored boolean := false;
  v_prev_age_ms bigint;
  v_reset_delta_ms bigint;
begin
  -- Serialize concurrent collectors/refreshes on this table. The lock is
  -- transaction-scoped: the waiter re-reads after the holder commits, so it
  -- always decides on the latest committed row.
  perform pg_advisory_xact_lock(hashtext('opencode_go_provider_snapshots'));

  select * into v_prev
    from public.opencode_go_provider_snapshots
    order by observed_at desc, created_at desc
    limit 1;

  if v_prev.id is null then
    insert into public.opencode_go_provider_snapshots
      (observed_at, fetched_at, monthly_percent, monthly_status, provider_resets_at, source, fetch_duration_ms)
    values
      (p_observed_at, p_fetched_at, p_monthly_percent, p_monthly_status, p_provider_resets_at, 'opencode_api', p_fetch_duration_ms)
    returning * into v_next;
    v_stored := true;
  else
    v_prev_age_ms := (extract(epoch from (now() - v_prev.observed_at)) * 1000)::bigint;
    v_reset_delta_ms := abs((extract(epoch from (p_provider_resets_at - v_prev.provider_resets_at)) * 1000)::bigint);

    -- Real changes are always stored, even inside the cooldown window:
    -- concurrent callers fetching the same new reading still append exactly
    -- once, because the losers re-read the winner's row and see no change.
    if p_monthly_percent is distinct from v_prev.monthly_percent
      or p_monthly_status is distinct from v_prev.monthly_status
      or v_reset_delta_ms > p_reset_tolerance_ms then
      insert into public.opencode_go_provider_snapshots
        (observed_at, fetched_at, monthly_percent, monthly_status, provider_resets_at, source, fetch_duration_ms)
      values
        (p_observed_at, p_fetched_at, p_monthly_percent, p_monthly_status, p_provider_resets_at, 'opencode_api', p_fetch_duration_ms)
      returning * into v_next;
      v_stored := true;
    elsif v_prev_age_ms < 0 then
      -- Clock skew: treat as fresh, do not append.
      v_next := v_prev;
    elsif v_prev_age_ms < p_cooldown_ms then
      -- Fresh equivalent observation already exists.
      v_next := v_prev;
    elsif v_prev_age_ms > p_max_age_ms then
      insert into public.opencode_go_provider_snapshots
        (observed_at, fetched_at, monthly_percent, monthly_status, provider_resets_at, source, fetch_duration_ms)
      values
        (p_observed_at, p_fetched_at, p_monthly_percent, p_monthly_status, p_provider_resets_at, 'opencode_api', p_fetch_duration_ms)
      returning * into v_next;
      v_stored := true;
    else
      v_next := v_prev;
    end if;
  end if;

  return jsonb_build_object('stored', v_stored, 'snapshot', row_to_json(v_next));
end;
$$;

revoke all on function public.append_opencode_go_provider_snapshot(
  numeric, text, timestamptz, integer, timestamptz, timestamptz, bigint, bigint, bigint
)
  from public, anon, authenticated;

grant execute on function public.append_opencode_go_provider_snapshot(
  numeric, text, timestamptz, integer, timestamptz, timestamptz, bigint, bigint, bigint
)
  to service_role;

alter function public.append_opencode_go_provider_snapshot(
  numeric, text, timestamptz, integer, timestamptz, timestamptz, bigint, bigint, bigint
)
  set search_path = pg_catalog, public;
