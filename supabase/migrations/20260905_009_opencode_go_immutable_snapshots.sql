-- Harden accepted OpenCode Go snapshots.
--
-- Accepted (`processed`) rows are immutable history: corrections arrive as
-- newer uploads, never as UPDATEs. Enforce that at the database level so no
-- application path can silently mutate or delete an accepted snapshot.
-- Also require processed rows to reference their private raw object.
-- Forward-only follow-up to 20260905_008_opencode_go_tracker.sql; that
-- migration is not modified.

create or replace function public.reject_opencode_go_processed_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'processed' then
    raise exception 'Accepted OpenCode Go snapshots are immutable (import %)', old.id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.reject_opencode_go_processed_mutation()
  from public, anon, authenticated;

grant execute on function public.reject_opencode_go_processed_mutation()
  to service_role;

drop trigger if exists opencode_go_imports_no_processed_mutation
  on public.opencode_go_imports;

create trigger opencode_go_imports_no_processed_mutation
  before update or delete on public.opencode_go_imports
  for each row execute function public.reject_opencode_go_processed_mutation();

alter table public.opencode_go_imports
  drop constraint if exists opencode_go_imports_processed_check;

alter table public.opencode_go_imports
  add constraint opencode_go_imports_processed_check check (
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
      and storage_path is not null
    )
  );
