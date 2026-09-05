import "server-only";

export type SupabaseAdminLike = {
  from: (table: string) => unknown;
};

export type OpenCodeGoImportRow = {
  id: string;
  status: string;
  duplicate_of_import_id: string | null;
  storage_path: string | null;
  filename: string;
  file_size_bytes: number;
  raw_sha256: string;
  tracking_start: string | null;
  reset_at: string | null;
  check_time: string | null;
  baseline_usage: number | null;
  hard_limit: number | null;
  safety_reserve: number | null;
  planned_ceiling: number | null;
  latest_actual_usage: number | null;
  latest_actual_date: string | null;
  parsed_snapshot: unknown;
  formula_mismatch_count: number;
  formula_warnings: unknown;
  imported_by: string | null;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
};

type QueryChain = {
  select: (cols: string) => QueryChain;
  eq: (col: string, value: unknown) => QueryChain;
  neq: (col: string, value: unknown) => QueryChain;
  in: (col: string, values: unknown[]) => QueryChain;
  order: (col: string, opts: { ascending: boolean }) => QueryChain;
  limit: (n: number) => QueryChain;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
};

function table(client: SupabaseAdminLike, table: string): QueryChain {
  return (client.from(table) as QueryChain)
    .select("*");
}

/**
 * Active dashboard snapshot: newest cycle first, then newest accepted
 * snapshot within that cycle. Processed rows only — a late upload of an
 * older cycle never replaces a newer active cycle.
 */
export async function getActiveOpenCodeGoSnapshot(
  client: SupabaseAdminLike,
): Promise<OpenCodeGoImportRow | null> {
  const { data, error } = await table(client, "opencode_go_imports")
    .eq("status", "processed")
    .order("tracking_start", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Could not read the active OpenCode Go snapshot.");
  return (data as OpenCodeGoImportRow | null) ?? null;
}

/** Latest accepted snapshot for one exact (trackingStart, resetAt) cycle. */
export async function getLatestAcceptedSnapshotForCycle(
  client: SupabaseAdminLike,
  cycle: { trackingStartIso: string; resetAtIso: string },
): Promise<OpenCodeGoImportRow | null> {
  const { data, error } = await table(client, "opencode_go_imports")
    .eq("status", "processed")
    .eq("tracking_start", cycle.trackingStartIso)
    .eq("reset_at", cycle.resetAtIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Could not read the OpenCode Go cycle history.");
  return (data as OpenCodeGoImportRow | null) ?? null;
}

/** Newest-first import history across all statuses. */
export async function listOpenCodeGoImports(
  client: SupabaseAdminLike,
  limit: number = 50,
): Promise<OpenCodeGoImportRow[]> {
  const query = table(client, "opencode_go_imports")
    .order("created_at", { ascending: false })
    .limit(limit) as unknown as Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await query;
  if (error) throw new Error("Could not read OpenCode Go import history.");
  return (data as OpenCodeGoImportRow[] | null) ?? [];
}
