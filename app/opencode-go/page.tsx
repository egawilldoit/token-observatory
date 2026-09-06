import { redirect } from "next/navigation";
import { Suspense } from "react";

import { TrackerDashboard } from "@/components/opencode-go/tracker-dashboard";
import { TrackerUpload } from "@/components/opencode-go/tracker-upload";
import { ImportHistory } from "@/components/opencode-go/import-history";
import { AppShell } from "@/components/telemetry/app-shell";
import { TelemetryRouteLoading } from "@/components/telemetry/route-loading";
import { SetupRequired } from "@/components/telemetry/setup-required";
import { hasObservatoryAccess } from "@/lib/auth/require-user";
import { getActiveOpenCodeGoSnapshot, listOpenCodeGoImports } from "@/lib/opencode-go/queries";
import { listProviderSnapshots } from "@/lib/opencode-go/provider-queries";
import type { StoredSnapshot } from "@/lib/opencode-go/snapshot";
import {
  buildV2ChartPoints,
  buildV2CheckpointRows,
  buildV2View,
} from "@/lib/opencode-go/v2-view";
import { createAdminClient, isTelemetryConfigured } from "@/lib/supabase/admin";

async function OpenCodeGoRuntime() {
  if (!(await hasObservatoryAccess())) {
    redirect("/auth/unauthorized");
  }

  const supabase = createAdminClient();
  const [active, history] = await Promise.all([
    getActiveOpenCodeGoSnapshot(supabase),
    listOpenCodeGoImports(supabase, 50),
  ]);
  // Provider observations are best-effort: when the V2 snapshots table has
  // not been migrated yet (or is unreadable), the page still renders the
  // safe contract with a SYNC_STALE comparison instead of failing.
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

  if (!view.hasContract || !view.contract || !view.comparison || !view.contractMeta) {
    return (
      <TrackerDashboard data={null} history={<ImportHistory rows={history} />}>
        <TrackerUpload />
      </TrackerDashboard>
    );
  }

  const checkpointRows = buildV2CheckpointRows({
    contract: view.contract,
    comparison: view.comparison,
    providerHistoryNewestFirst: providerSnapshots,
    nowMs,
  });
  const chartPoints = buildV2ChartPoints(checkpointRows, view.contract);
  const roomToNext =
    view.comparison.nextCeiling != null && view.comparison.providerMonthly != null
      ? view.comparison.nextCeiling - view.comparison.providerMonthly
      : null;
  const latestObservedAtMs = view.providerSnapshot
    ? Date.parse(view.providerSnapshot.observed_at)
    : null;

  return (
    <TrackerDashboard
      data={{
        contractMeta: view.contractMeta,
        comparison: view.comparison,
        checkpointRows,
        chartPoints,
        latestObservedAtMs: Number.isFinite(latestObservedAtMs as number)
          ? (latestObservedAtMs as number)
          : null,
        providerHistoryCount: providerSnapshots.length,
        nowMs,
        roomToNext,
      }}
      history={<ImportHistory rows={history} />}
    >
      <TrackerUpload />
    </TrackerDashboard>
  );
}

export default function OpenCodeGoPage() {
  if (!isTelemetryConfigured()) {
    return (
      <AppShell>
        <SetupRequired />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Suspense fallback={<TelemetryRouteLoading />}>
        <OpenCodeGoRuntime />
      </Suspense>
    </AppShell>
  );
}
