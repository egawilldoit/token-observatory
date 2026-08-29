import { redirect } from "next/navigation";

import { AppShell } from "@/components/telemetry/app-shell";
import { ImportPanel } from "@/components/telemetry/import-panel";
import { SetupRequired } from "@/components/telemetry/setup-required";
import { hasObservatoryAccess } from "@/lib/auth/require-user";
import { isTelemetryConfigured } from "@/lib/supabase/admin";
import {
  getMachineCollectionHints,
  getRecentImports,
} from "@/lib/telemetry/queries";

function compact(value: unknown) {
  const number = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(number)) return "—";
  if (Math.abs(number) >= 1_000_000_000) {
    return (number / 1_000_000_000).toFixed(2) + "B";
  }
  if (Math.abs(number) >= 1_000_000) {
    return (number / 1_000_000).toFixed(1) + "M";
  }
  return number.toLocaleString();
}

export default async function ImportsPage() {
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

  const [machines, recent] = await Promise.all([
    getMachineCollectionHints(),
    getRecentImports(),
  ]);

  return (
    <AppShell>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
          Ingestion
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
          Import ccusage snapshots
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Exact datasets are skipped globally, overlapping days are diffed, and
          only new or revised observations are promoted.
        </p>
      </header>

      <div className="mt-7">
        <ImportPanel machines={machines} />
      </div>

      <section className="mt-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5">
        <div className="mb-5">
          <h2 className="font-semibold">Recent imports</h2>
          <p className="mt-1 text-xs text-slate-500">
            Raw provenance and processing outcome
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-slate-600">
              <tr>
                <th className="pb-3 font-medium">Created</th>
                <th className="pb-3 font-medium">Machine</th>
                <th className="pb-3 font-medium">Scope</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium">Change</th>
                <th className="pb-3 font-medium">Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {recent.map((item) => {
                const summary = item.summary ?? {};
                return (
                  <tr key={item.id} className="text-slate-400">
                    <td className="py-3 pr-4">
                      {new Intl.DateTimeFormat("en-GB", {
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(item.created_at))}
                    </td>
                    <td className="py-3 pr-4 font-medium text-slate-300">
                      {item.machine_id}
                    </td>
                    <td className="py-3 pr-4">
                      {item.scope_start && item.scope_end
                        ? item.scope_start + " → " + item.scope_end
                        : "—"}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="rounded-full border border-white/10 px-2 py-1">
                        {item.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {summary.netChange !== undefined
                        ? compact(summary.netChange)
                        : "—"}
                    </td>
                    <td className="py-3 font-mono text-slate-600">
                      {item.raw_sha256.slice(0, 10)}
                      {item.cross_machine_match ? " · cross-machine duplicate" : ""}
                    </td>
                  </tr>
                );
              })}
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-600">
                    No imports yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
