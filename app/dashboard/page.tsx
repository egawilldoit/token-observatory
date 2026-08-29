import { redirect } from "next/navigation";

import { AppShell } from "@/components/telemetry/app-shell";
import { DashboardView } from "@/components/telemetry/dashboard-view";
import { SetupRequired } from "@/components/telemetry/setup-required";
import { hasObservatoryAccess } from "@/lib/auth/require-user";
import { isTelemetryConfigured } from "@/lib/supabase/admin";
import { getCurrentDailyUsage, getMachines } from "@/lib/telemetry/queries";

export default async function DashboardPage() {
  if (!isTelemetryConfigured()) {
    return (
      <AppShell>
        <SetupRequired />
      </AppShell>
    );
  }

  if (!(await hasObservatoryAccess())) {
    redirect("/auth/unauthorized");
  }

  const [rows, machines] = await Promise.all([
    getCurrentDailyUsage(),
    getMachines(),
  ]);

  return (
    <AppShell>
      <DashboardView rows={rows} machines={machines} />
    </AppShell>
  );
}
