-- Keep the private raw-workbook bucket aligned with the effective Vercel
-- request limit. Vercel Functions reject request bodies above 4.5 MB before
-- application code runs, so V1 accepts files up to 4 MiB and reserves the
-- remaining request budget for multipart framing.
update storage.buckets
set file_size_limit = 4 * 1024 * 1024
where id = 'opencode-go-imports';

do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'opencode-go-imports'
      and public is false
      and file_size_limit = 4 * 1024 * 1024
  ) then
    raise exception 'OpenCode Go private bucket upload limit correction failed';
  end if;
end;
$$;
