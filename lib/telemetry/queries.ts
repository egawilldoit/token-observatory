import "server-only";

import { createAdminClient, isTelemetryConfigured } from "@/lib/supabase/admin";
import { buildCcusageCommand, nextSinceFromDate } from "./config";
import type {
  CurrentDailyModelUsageRow,
  CurrentDailyUsageRow,
} from "@/lib/ccusage/types";

export type MachineRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

export type ImportRow = {
  id: string;
  machine_id: string;
  filename: string | null;
  raw_sha256: string;
  ccusage_version: string | null;
  scope_start: string | null;
  scope_end: string | null;
  status: string;
  summary: Record<string, unknown> | null;
  cross_machine_match: boolean;
  created_at: string;
  processed_at: string | null;
};

type MachineCollectionStateRow = {
  machine_id: string;
  last_scope_end: string | null;
};

type MachineSessionEvidenceStateRow = {
  machine_id: string;
  session_count: number | string;
  mirror_fingerprint_count: number | string;
  last_session_evidence_at: string | null;
};

export type MachineCollectionHint = MachineRow & {
  lastAcceptedScopeEnd: string | null;
  nextSince: string | null;
  command: string;
  sessionEvidenceCount: number;
  mirrorFingerprintCount: number;
  lastSessionEvidenceAt: string | null;
};

export async function getMachines(): Promise<MachineRow[]> {
  if (!isTelemetryConfigured()) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("machines")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (error) throw error;
  return (data ?? []) as MachineRow[];
}

export async function getCurrentDailyUsage(): Promise<CurrentDailyUsageRow[]> {
  if (!isTelemetryConfigured()) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("v_current_daily_usage_dedupe")
    .select("*")
    .order("usage_date", { ascending: true });

  if (error) throw error;
  return (data ?? []) as CurrentDailyUsageRow[];
}

export async function getCurrentDailyModelUsage(): Promise<
  CurrentDailyModelUsageRow[]
> {
  if (!isTelemetryConfigured()) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("v_current_daily_model_usage_dedupe")
    .select("*")
    .order("usage_date", { ascending: true });

  if (error) throw error;
  return (data ?? []) as CurrentDailyModelUsageRow[];
}

export async function getRecentImports(limit = 20): Promise<ImportRow[]> {
  if (!isTelemetryConfigured()) return [];
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("imports")
    .select(
      "id,machine_id,filename,raw_sha256,ccusage_version,scope_start,scope_end,status,summary,cross_machine_match,created_at,processed_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as ImportRow[];
}

async function getMachineCollectionState(): Promise<MachineCollectionStateRow[]> {
  if (!isTelemetryConfigured()) return [];

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("v_machine_collection_state")
    .select("machine_id,last_scope_end");

  if (error) throw error;
  return (data ?? []) as MachineCollectionStateRow[];
}

async function getMachineSessionEvidenceState(): Promise<
  MachineSessionEvidenceStateRow[]
> {
  if (!isTelemetryConfigured()) return [];

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("v_machine_session_evidence_state")
    .select(
      "machine_id,session_count,mirror_fingerprint_count,last_session_evidence_at",
    );

  if (error) throw error;
  return (data ?? []) as MachineSessionEvidenceStateRow[];
}

export async function getMachineCollectionHints(): Promise<
  MachineCollectionHint[]
> {
  const [machines, stateRows, sessionRows] = await Promise.all([
    getMachines(),
    getMachineCollectionState(),
    getMachineSessionEvidenceState(),
  ]);

  const lastScopeEndByMachine = new Map(
    stateRows.map((row) => [row.machine_id, row.last_scope_end] as const),
  );
  const sessionsByMachine = new Map(
    sessionRows.map((row) => [row.machine_id, row] as const),
  );

  return machines.map((machine) => {
    const lastDate = lastScopeEndByMachine.get(machine.id) ?? null;
    const since = nextSinceFromDate(lastDate);
    const sessionState = sessionsByMachine.get(machine.id);

    return {
      ...machine,
      lastAcceptedScopeEnd: lastDate,
      nextSince: since,
      command: buildCcusageCommand(since),
      sessionEvidenceCount: Number(sessionState?.session_count ?? 0),
      mirrorFingerprintCount: Number(
        sessionState?.mirror_fingerprint_count ?? 0,
      ),
      lastSessionEvidenceAt:
        sessionState?.last_session_evidence_at ?? null,
    };
  });
}
