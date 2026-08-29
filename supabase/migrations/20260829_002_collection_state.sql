create or replace view public.v_machine_collection_state
with (security_invoker = true)
as
select
  m.id as machine_id,
  max(i.scope_end) filter (where i.status = 'processed') as last_scope_end
from public.machines m
left join public.imports i on i.machine_id = m.id
where m.is_active
group by m.id;

revoke all on table public.v_machine_collection_state from anon, authenticated;
grant select on table public.v_machine_collection_state to service_role;
