import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppShell } from "@/components/telemetry/app-shell";
import { DashboardView } from "@/components/telemetry/dashboard-view";
import { TelemetryRouteLoading } from "@/components/telemetry/route-loading";
import { SetupRequired } from "@/components/telemetry/setup-required";
import { hasObservatoryAccess } from "@/lib/auth/require-user";
import { isTelemetryConfigured } from "@/lib/supabase/admin";
import {
  getCurrentDailyUsage,
  getMachineCollectionHints,
  getMachines,
  getRecentImports,
} from "@/lib/telemetry/queries";

async function DashboardRuntime() {
  if (!(await hasObservatoryAccess())) {
    redirect("/auth/unauthorized");
  }

  const [rows, machines, recentImports, collectionHints] = await Promise.all([
    getCurrentDailyUsage(),
    getMachines(),
    getRecentImports(4),
    getMachineCollectionHints(),
  ]);

  return (
    <DashboardView
      rows={rows}
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
