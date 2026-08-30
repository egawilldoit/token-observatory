import { redirect } from "next/navigation";
import { Suspense } from "react";

import { AppShell } from "@/components/telemetry/app-shell";
import { ImportPanel } from "@/components/telemetry/import-panel";
import { TelemetryRouteLoading } from "@/components/telemetry/route-loading";
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

async function ImportsRuntime() {
  if (!(await hasObservatoryAccess())) {
    redirect("/auth/unauthorized");
  }

  const [machines, recent] = await Promise.all([
    getMachineCollectionHints(),
    getRecentImports(),
  ]);

  return (
    <>
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
          Ingestion
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950 md:text-[2rem]">
          Import ccusage snapshots
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          Same-machine exact datasets are skipped, overlapping days are diffed,
          and only canonical changes are promoted.
        </p>
      </header>

      <div className="mt-7">
        <ImportPanel machines={machines} />
      </div>

      <section className="mt-5 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)]">
        <div className="mb-5">
          <h2 className="font-semibold text-slate-950">Recent imports</h2>
          <p className="mt-1 text-xs text-slate-500">
            Raw provenance and processing outcome
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="pb-3 font-medium">Created</th>
                <th className="pb-3 font-medium">Machine</th>
                <th className="pb-3 font-medium">Scope</th>
                <th className="pb-3 font-medium">Status</th>
                <th className="pb-3 font-medium">Change</th>
                <th className="pb-3 font-medium">Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recent.map((item) => {
                const summary = item.summary ?? {};
                return (
                  <tr key={item.id} className="text-slate-500">
                    <td className="py-3 pr-4">
                      {new Intl.DateTimeFormat("en-GB", {
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(item.created_at))}
                    </td>
                    <td className="py-3 pr-4 font-medium text-slate-700">
                      {item.machine_id}
                    </td>
                    <td className="py-3 pr-4">
                      {item.scope_start && item.scope_end
                        ? item.scope_start + " → " + item.scope_end
                        : "—"}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-medium text-emerald-700">
                        {item.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {summary.netChange !== undefined
                        ? compact(summary.netChange)
                        : "—"}
                    </td>
                    <td className="py-3 font-mono text-slate-500">
                      {item.raw_sha256.slice(0, 10)}
                      {item.cross_machine_match ? " · cross-machine match" : ""}
                    </td>
                  </tr>
                );
              })}
              {recent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-500">
                    No imports yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export default function ImportsPage() {
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
        <ImportsRuntime />
      </Suspense>
    </AppShell>
  );
}
