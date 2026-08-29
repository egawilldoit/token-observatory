"use client";

import {
  Cpu,
  Database,
  Gauge,
  Layers3,
  Server,
  Sigma,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { CurrentDailyUsageRow } from "@/lib/ccusage/types";
import type { MachineRow } from "@/lib/telemetry/queries";

function compact(value: number) {
  if (Math.abs(value) >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(2).replace(/\.00$/, "") + "B";
  }
  if (Math.abs(value) >= 1_000_000) {
    return (value / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (Math.abs(value) >= 1_000) {
    return (value / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  }
  return value.toLocaleString();
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function Metric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Gauge;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          {label}
        </p>
        <Icon className="h-4 w-4 text-slate-600" />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
      <p className="mt-1 truncate text-xs text-slate-500">{detail}</p>
    </div>
  );
}

export function DashboardView({
  rows,
  machines,
}: {
  rows: CurrentDailyUsageRow[];
  machines: MachineRow[];
}) {
  const [machine, setMachine] = useState("all");
  const [agent, setAgent] = useState("all");
  const [granularity, setGranularity] = useState<"day" | "week" | "month">("day");

  const agents = useMemo(
    () => [...new Set(rows.map((row) => row.agent))].sort(),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (machine === "all" || row.machine_id === machine) &&
          (agent === "all" || row.agent === agent),
      ),
    [agent, machine, rows],
  );

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, row) => {
          acc.total += row.reported_total_tokens;
          acc.input += row.input_tokens;
          acc.output += row.output_tokens;
          acc.cache += row.cache_read_tokens;
          acc.delta += row.accounting_delta_tokens;
          if (row.reported_cost_usd !== null) {
            acc.cost += row.reported_cost_usd;
            acc.costRows += 1;
          }
          return acc;
        },
        {
          total: 0,
          input: 0,
          output: 0,
          cache: 0,
          delta: 0,
          cost: 0,
          costRows: 0,
        },
      ),
    [filtered],
  );

  const byPeriod = useMemo(() => {
    const values = new Map<string, number>();

    function periodKey(date: string) {
      if (granularity === "month") return date.slice(0, 7);
      if (granularity === "week") {
        const value = new Date(date + "T12:00:00Z");
        const day = value.getUTCDay();
        const mondayOffset = day === 0 ? -6 : 1 - day;
        value.setUTCDate(value.getUTCDate() + mondayOffset);
        return value.toISOString().slice(0, 10);
      }
      return date;
    }

    for (const row of filtered) {
      const key = periodKey(row.usage_date);
      values.set(key, (values.get(key) ?? 0) + row.reported_total_tokens);
    }

    return [...values.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({ date, total }));
  }, [filtered, granularity]);

  const byAgent = useMemo(() => {
    const values = new Map<string, number>();
    for (const row of filtered) {
      values.set(row.agent, (values.get(row.agent) ?? 0) + row.reported_total_tokens);
    }
    return [...values.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const byMachine = useMemo(() => {
    const values = new Map<string, number>();
    for (const row of filtered) {
      values.set(
        row.machine_id,
        (values.get(row.machine_id) ?? 0) + row.reported_total_tokens,
      );
    }
    return [...values.entries()].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const maxPeriod = Math.max(...byPeriod.map((period) => period.total), 1);
  const maxAgent = Math.max(...byAgent.map((item) => item[1]), 1);
  const maxMachine = Math.max(...byMachine.map((item) => item[1]), 1);
  const cacheShare = totals.total ? (totals.cache / totals.total) * 100 : 0;

  return (
    <div>
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
            Global telemetry
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] md:text-4xl">
            Token burn, without snapshot inflation.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Current daily truth across every accepted ccusage import. Filters never
            touch raw observations.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <div
            role="group"
            aria-label="Aggregation granularity"
            className="flex rounded-xl border border-white/10 bg-[#0b1722] p-1"
          >
            {(["day", "week", "month"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={granularity === value}
                onClick={() => setGranularity(value)}
                className={[
                  "rounded-lg px-3 py-1.5 text-xs capitalize transition",
                  granularity === value
                    ? "bg-white/[0.09] text-white"
                    : "text-slate-500 hover:text-slate-300",
                ].join(" ")}
              >
                {value}
              </button>
            ))}
          </div>
          <select
            aria-label="Filter by machine"
            value={machine}
            onChange={(event) => setMachine(event.target.value)}
            className="h-10 rounded-xl border border-white/10 bg-[#0b1722] px-3 text-sm text-slate-300 outline-none ring-cyan-400 focus:ring-1"
          >
            <option value="all">All machines</option>
            {machines.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by agent"
            value={agent}
            onChange={(event) => setAgent(event.target.value)}
            className="h-10 rounded-xl border border-white/10 bg-[#0b1722] px-3 text-sm text-slate-300 outline-none ring-cyan-400 focus:ring-1"
          >
            <option value="all">All agents</option>
            {agents.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-white/[0.025] px-6 py-16 text-center">
          <Database className="mx-auto h-8 w-8 text-slate-600" />
          <h2 className="mt-4 text-xl font-semibold">No accepted usage yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            Register a machine, then import your first pinned ccusage daily JSON.
            The dashboard will derive all totals from that current daily view.
          </p>
        </div>
      ) : (
        <>
          <section className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <Metric
              label="Total tokens"
              value={compact(totals.total)}
              detail={totals.total.toLocaleString() + " exact"}
              icon={Sigma}
            />
            <Metric
              label="Cache read"
              value={compact(totals.cache)}
              detail={cacheShare.toFixed(1) + "% of reported total"}
              icon={Layers3}
            />
            <Metric
              label="Input"
              value={compact(totals.input)}
              detail="fresh input tokens"
              icon={Cpu}
            />
            <Metric
              label="Output"
              value={compact(totals.output)}
              detail="generated output tokens"
              icon={Gauge}
            />
            <Metric
              label="Machines"
              value={String(byMachine.length)}
              detail="contributing to this filter"
              icon={Server}
            />
            <Metric
              label="ccusage cost"
              value={totals.costRows ? money(totals.cost) : "—"}
              detail={
                totals.costRows
                  ? "reported estimate · " +
                    totals.costRows +
                    "/" +
                    filtered.length +
                    " rows priced"
                  : "no cost data reported"
              }
              icon={Database}
            />
          </section>

          <section className="mt-4 grid gap-4 xl:grid-cols-[1.55fr_.75fr]">
            <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
              <div className="mb-6 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">
                    {granularity === "day"
                      ? "Daily burn"
                      : granularity === "week"
                        ? "Weekly burn"
                        : "Monthly burn"}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Reported total tokens grouped from canonical daily truth
                  </p>
                </div>
                <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-slate-500">
                  {byPeriod.length} {granularity === "day" ? "days" : granularity === "week" ? "weeks" : "months"}
                </span>
              </div>

              <div className="flex h-72 items-end gap-1 overflow-x-auto border-b border-white/10 pb-1">
                {byPeriod.map((day, index) => {
                  const height = day.total === 0 ? 0 : Math.max(2, (day.total / maxPeriod) * 100);
                  const labelEvery = byPeriod.length > 20 ? 5 : 2;
                  return (
                    <div
                      key={day.date}
                      className="group flex h-full min-w-[16px] flex-1 flex-col justify-end"
                      role="img"
                      aria-label={
                        day.date +
                        ": " +
                        day.total.toLocaleString() +
                        " reported tokens"
                      }
                      title={day.date + ": " + day.total.toLocaleString() + " tokens"}
                    >
                      <div className="mb-2 hidden text-center text-[9px] text-slate-500 group-hover:block">
                        {compact(day.total)}
                      </div>
                      <div
                        className="w-full rounded-t-[5px] bg-cyan-300/70 transition hover:bg-cyan-200"
                        style={{ height: height + "%" }}
                      />
                      <span className="mt-2 h-4 text-center text-[9px] text-slate-600">
                        {index % labelEvery === 0
                          ? granularity === "month"
                            ? day.date.slice(5)
                            : day.date.slice(8)
                          : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
              <h2 className="font-semibold">Agent share</h2>
              <p className="mt-1 text-xs text-slate-500">
                Current accepted daily observations
              </p>
              <div className="mt-6 space-y-5">
                {byAgent.map(([name, value]) => (
                  <div key={name}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                      <span className="truncate capitalize text-slate-300">
                        {name}
                      </span>
                      <span className="text-xs tabular-nums text-slate-500">
                        {compact(value)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-violet-400/80"
                        style={{ width: (value / maxAgent) * 100 + "%" }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-4 rounded-3xl border border-white/10 bg-white/[0.035] p-5">
            <div className="mb-5">
              <h2 className="font-semibold">Machine contribution</h2>
              <p className="mt-1 text-xs text-slate-500">
                Physical source selected during upload
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {byMachine.map(([id, value]) => {
                const machineRow = machines.find((item) => item.id === id);
                return (
                  <div
                    key={id}
                    className="rounded-2xl border border-white/10 bg-black/15 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium">
                        {machineRow?.name ?? id}
                      </p>
                      <span className="text-xs tabular-nums text-slate-500">
                        {compact(value)}
                      </span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-emerald-400/70"
                        style={{ width: (value / maxMachine) * 100 + "%" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {totals.delta !== 0 ? (
            <p className="mt-4 text-xs text-slate-600">
              Accounting delta preserved from ccusage: {compact(totals.delta)}.
              It is intentionally not assigned a semantic meaning.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
