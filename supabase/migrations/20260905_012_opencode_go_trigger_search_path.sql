-- Harden the OpenCode Go immutability trigger function's execution context.
-- The function does not resolve application objects by name, so a fixed
-- pg_catalog-only search_path removes caller-controlled schema resolution and
-- clears Supabase's function_search_path_mutable security advisory.
alter function public.reject_opencode_go_processed_mutation()
  set search_path = pg_catalog;
