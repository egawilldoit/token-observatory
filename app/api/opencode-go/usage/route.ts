import { NextResponse } from "next/server";

import { getObservatoryAccess } from "@/lib/auth/require-user";
import { buildV2View } from "@/lib/opencode-go/v2-view";
import { getActiveOpenCodeGoSnapshot, listOpenCodeGoImports } from "@/lib/opencode-go/queries";
import {
  getLatestTwoProviderSnapshots,
  listProviderSnapshots,
} from "@/lib/opencode-go/provider-queries";
import type { StoredSnapshot } from "@/lib/opencode-go/snapshot";
import { isCrossOriginRequest } from "@/lib/http/request";
import { createAdminClient, isTelemetryConfigured } from "@/lib/supabase/admin";

/**
 * V2 current state (DB only, no live fetch, no secret).
 * Returns the server-computed comparison so the browser never runs domain logic.
 */
export async function GET() {
  if (!isTelemetryConfigured()) {
    return NextResponse.json({ error: "Supabase telemetry is not configured." }, { status: 503 });
  }
  const access = await getObservatoryAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!access.authorized) {
    return NextResponse.json({ error: "Observatory access denied." }, { status: 403 });
  }

  const supabase = createAdminClient();
  const active = await getActiveOpenCodeGoSnapshot(supabase);
  // Best-effort: pre-migration deployments without the snapshots table still
  // return the contract with a SYNC_STALE comparison.
  let providerSnapshots: Awaited<ReturnType<typeof listProviderSnapshots>> = [];
  try {
    providerSnapshots = await listProviderSnapshots(supabase, 60);
  } catch {
    providerSnapshots = [];
  }

  const nowMs = Date.now();
  const view = buildV2View({
    contractSnapshot: (active?.parsed_snapshot as StoredSnapshot | null) ?? null,
    contractMeta: active
      ? {
          filename: active.filename,
          importedAt: active.created_at,
          trackingStartIso: active.tracking_start as string,
          resetAtIso: active.reset_at as string,
          checkTime: (active.check_time as string) ?? "12:00",
          baseline: Number(active.baseline_usage),
          hardLimit: Number(active.hard_limit),
          safetyReserve: Number(active.safety_reserve),
          plannedCeiling: Number(active.planned_ceiling),
        }
      : null,
    providerSnapshotsNewestFirst: providerSnapshots,
    nowMs,
  });

  void listOpenCodeGoImports;
  void getLatestTwoProviderSnapshots;

  return NextResponse.json({
    nowIso: view.nowIso,
    hasContract: view.hasContract,
    contractMeta: view.contractMeta,
    comparison: view.comparison,
    providerSnapshot: view.providerSnapshot,
  });
}

export async function POST(request: Request) {
  if (isCrossOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin mutations are not allowed." }, { status: 403 });
  }
  return GET();
}
