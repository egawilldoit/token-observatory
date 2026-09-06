// SERVER-SIDE ONLY: import exclusively from server components and route handlers.
// The service-role client must never reach the browser.

export type SupabaseAdminLike = {
  from: (table: string) => unknown;
  /** Thenable on purpose: the real client returns a PostgrestFilterBuilder. */
  rpc?: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export type OpenCodeGoProviderSnapshotRow = {
  id: string;
  observed_at: string;
  fetched_at: string;
  monthly_percent: number;
  monthly_status: string;
  provider_resets_at: string;
  source: string;
  fetch_duration_ms: number;
  created_at: string;
};

type QueryChain = {
  select: (cols: string) => QueryChain;
  eq: (col: string, value: unknown) => QueryChain;
  order: (col: string, opts: { ascending: boolean }) => QueryChain;
  limit: (n: number) => QueryChain;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
};

/**
 * Latest provider observation, newest first. Never fabricated: returns null
 * when no snapshot has ever been stored.
 */
export async function getLatestProviderSnapshot(
  client: SupabaseAdminLike,
): Promise<OpenCodeGoProviderSnapshotRow | null> {
  const chain = (client.from("opencode_go_provider_snapshots") as QueryChain).select("*");
  const { data, error } = await chain
    .order("observed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Could not read the latest provider observation.");
  return (data as OpenCodeGoProviderSnapshotRow | null) ?? null;
}

/** Two latest observations (newest first) for rollover detection. */
export async function getLatestTwoProviderSnapshots(
  client: SupabaseAdminLike,
): Promise<OpenCodeGoProviderSnapshotRow[]> {
  const query = (client.from("opencode_go_provider_snapshots") as QueryChain)
    .select("*")
    .order("observed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(2) as unknown as Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await query;
  if (error) throw new Error("Could not read provider observations.");
  return (data as OpenCodeGoProviderSnapshotRow[] | null) ?? [];
}

/** Newest-first provider observation history (append-only evidence). */
export async function listProviderSnapshots(
  client: SupabaseAdminLike,
  limit: number = 60,
): Promise<OpenCodeGoProviderSnapshotRow[]> {
  const query = (client.from("opencode_go_provider_snapshots") as QueryChain)
    .select("*")
    .order("observed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit) as unknown as Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await query;
  if (error) throw new Error("Could not read provider observations.");
  return (data as OpenCodeGoProviderSnapshotRow[] | null) ?? [];
}

export type InsertProviderSnapshotInput = {
  monthlyFraction: number;
  monthlyStatus: string;
  providerResetsAtIso: string;
  fetchDurationMs: number;
  /**
   * `observed_at` = when the request started (proxy for the provider state
   * read; the API supplies no observation timestamp).
   */
  observedAtIso?: string;
  /** `fetched_at` = when the response was received. Defaults to observed_at. */
  fetchedAtIso?: string;
};

type InsertChain = {
  insert: (row: Record<string, unknown>) => {
    select: (cols: string) => {
      maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
    };
  };
};

export async function insertProviderSnapshot(
  client: SupabaseAdminLike,
  input: InsertProviderSnapshotInput,
): Promise<OpenCodeGoProviderSnapshotRow> {
  const nowIso = new Date().toISOString();
  const chain = client.from("opencode_go_provider_snapshots") as unknown as InsertChain;
  const { data, error } = await chain
    .insert({
      observed_at: input.observedAtIso ?? nowIso,
      fetched_at: input.fetchedAtIso ?? input.observedAtIso ?? nowIso,
      monthly_percent: input.monthlyFraction,
      monthly_status: input.monthlyStatus,
      provider_resets_at: input.providerResetsAtIso,
      source: "opencode_api",
      fetch_duration_ms: Math.max(0, Math.round(input.fetchDurationMs)),
    })
    .select("*")
    .maybeSingle();
  if (error || !data) throw new Error("Could not store the provider observation.");
  return data as OpenCodeGoProviderSnapshotRow;
}
