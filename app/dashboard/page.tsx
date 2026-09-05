import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppShell } from "@/components/telemetry/app-shell";
import { DashboardView } from "@/components/telemetry/dashboard-view";
import { TelemetryRouteLoading } from "@/components/telemetry/route-loading";
import { SetupRequired } from "@/components/telemetry/setup-required";
import { hasObservatoryAccess } from "@/lib/auth/require-user";
import { getLatestRecoveryEvidence } from "@/lib/recovery/queries";
import { isTelemetryConfigured } from "@/lib/supabase/admin";
import { buildUnifiedUsageProjection } from "@/lib/telemetry/unified-usage";
import {
  getCurrentDailyModelUsage,
  getCurrentDailyUsage,
  getMachineCollectionHints,
  getMachines,
  getRecentImports,
} from "@/lib/telemetry/queries";

async function DashboardRuntime() {
  if (!(await hasObservatoryAccess())) {
    redirect("/auth/unauthorized");
  }

  const [
    rows,
    modelRows,
    machines,
    recentImports,
    collectionHints,
    recoveredEvidence,
  ] = await Promise.all([
    getCurrentDailyUsage(),
    getCurrentDailyModelUsage(),
    getMachines(),
    getRecentImports(8),
    getMachineCollectionHints(),
    getLatestRecoveryEvidence(),
  ]);

  return (
    <DashboardView
      projection={buildUnifiedUsageProjection({
        canonicalDailyRows: rows,
        canonicalModelRows: modelRows,
        recoveredEvidence,
      })}
      machines={machines}
      recentImports={recentImports}
      collectionHints={collectionHints}
    />
  );
}

export default function DashboardPage() {
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
        <DashboardRuntime />
      </Suspense>
    </AppShell>
  );
}
