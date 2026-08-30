create index if not exists cross_machine_daily_canonical_machine_idx
  on public.cross_machine_daily_dedupe(canonical_machine_id);
