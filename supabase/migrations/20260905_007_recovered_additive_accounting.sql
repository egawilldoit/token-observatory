-- Correct the recovered set's provenance: it belongs to one lost PC and is
-- additive at aggregate/monthly-compatible levels, not a VM mirror.
alter table public.recovered_usage_sets
  drop constraint if exists recovered_usage_set_accounting_mode_check;

alter table public.recovered_usage_sets
  add constraint recovered_usage_set_accounting_mode_check check (
    accounting_mode in (
      'evidence_only_non_additive',
      'additive_recovered'
    )
  );

do $$
declare
  v_updated integer;
begin
  update public.recovered_usage_sets
  set
    description = 'Recovered ccusage monthly report from one permanently lost Windows PC',
    source_machine_count = 1,
    suspected_mirror = false,
    accounting_mode = 'additive_recovered'
  where id = 'lost-windows-history-2026-05-08';

  get diagnostics v_updated = row_count;

  if v_updated <> 1 or exists (
    select 1
    from public.recovered_usage_sets
    where id = 'lost-windows-history-2026-05-08'
      and (
        source_machine_count <> 1
        or suspected_mirror is distinct from false
        or accounting_mode <> 'additive_recovered'
      )
  ) then
    raise exception 'Recovered additive accounting correction failed';
  end if;
end;
$$;
