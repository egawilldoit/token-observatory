import { AppShell } from "@/components/telemetry/app-shell";
import { DashboardView } from "@/components/telemetry/dashboard-view";
import { SetupRequired } from "@/components/telemetry/setup-required";
import { isTelemetryConfigured } from "@/lib/supabase/admin";
import { getCurrentDailyUsage, getMachines } from "@/lib/telemetry/queries";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  if (!isTelemetryConfigured()) {
    return (
      <AppShell>
        <SetupRequired />
      </AppShell>
    );
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
