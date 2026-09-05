import { redirect } from "next/navigation";
import { Suspense } from "react";

import { TrackerDashboard } from "@/components/opencode-go/tracker-dashboard";
import { AppShell } from "@/components/telemetry/app-shell";
import { TelemetryRouteLoading } from "@/components/telemetry/route-loading";
import { SetupRequired } from "@/components/telemetry/setup-required";
import { hasObservatoryAccess } from "@/lib/auth/require-user";
import { getActiveOpenCodeGoSnapshot, listOpenCodeGoImports } from "@/lib/opencode-go/queries";
import type { StoredSnapshot } from "@/lib/opencode-go/snapshot";
import { buildTrackerViewModel } from "@/lib/opencode-go/view-model";
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

  const nowMs = Date.now();
  const view =
    active?.parsed_snapshot != null
      ? buildTrackerViewModel(active.parsed_snapshot as StoredSnapshot, nowMs)
      : null;

  void history;

  return <TrackerDashboard view={view} />;
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
