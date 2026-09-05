-- Serialize same-cycle OpenCode Go imports so history-regression and plan-freeze
-- validation cannot race against another upload for the same cycle.
--
-- The import route inserts its processing row before reading the latest
-- accepted same-cycle snapshot. PostgreSQL's unique-index check therefore
-- waits for an in-flight same-cycle promotion to finish (or rejects another
-- still-processing row), after which the route validates against the newest
-- processed snapshot.
create unique index if not exists opencode_go_imports_one_processing_per_cycle
  on public.opencode_go_imports (tracking_start, reset_at)
  where status = 'processing'
    and tracking_start is not null
    and reset_at is not null;
