import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppShell } from "@/components/telemetry/app-shell";
import { DashboardView } from "@/components/telemetry/dashboard-view";
import { TelemetryRouteLoading } from "@/components/telemetry/route-loading";
import { SetupRequired } from "@/components/telemetry/setup-required";
import { hasObservatoryAccess } from "@/lib/auth/require-user";
import { getLatestRecoveryEvidence } from "@/lib/recovery/queries";
import { isTelemetryConfigured } from "@/lib/supabase/admin";
import { getKnownUsageTotals } from "@/lib/telemetry/known-usage";
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
    knownUsageTotals,
  ] = await Promise.all([
    getCurrentDailyUsage(),
    getCurrentDailyModelUsage(),
    getMachines(),
    getRecentImports(8),
    getMachineCollectionHints(),
    getLatestRecoveryEvidence(),
    getKnownUsageTotals(),
  ]);

  return (
    <DashboardView
      rows={rows}
      modelRows={modelRows}
      machines={machines}
      recentImports={recentImports}
      collectionHints={collectionHints}
      recoveredEvidence={recoveredEvidence}
      knownUsageTotals={knownUsageTotals}
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
