import { AppShell } from "@/components/telemetry/app-shell";
import { MachineManager } from "@/components/telemetry/machine-manager";
import { SetupRequired } from "@/components/telemetry/setup-required";
import { isTelemetryConfigured } from "@/lib/supabase/admin";
import { getMachines } from "@/lib/telemetry/queries";


export default async function MachinesPage() {
  if (!isTelemetryConfigured()) {
    return (
      <AppShell>
        <SetupRequired />
      </AppShell>
    );
  }

  const machines = await getMachines();

  return (
    <AppShell>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
          Sources
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
          Machine registry
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Stable identities prevent accidental Work-PC / work pc / WorkPC
          fragmentation at import time.
        </p>
      </header>

      <div className="mt-7">
        <MachineManager machines={machines} />
      </div>
    </AppShell>
  );
}
