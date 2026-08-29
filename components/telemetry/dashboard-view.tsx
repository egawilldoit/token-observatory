"use client";

import {
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Copy,
  Cpu,
  Database,
  Gauge,
  Layers3,
  Loader2,
  Server,
  Sigma,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  CurrentDailyModelUsageRow,
  CurrentDailyUsageRow,
} from "@/lib/ccusage/types";
import type {
  ImportRow,
  MachineCollectionHint,
  MachineRow,
} from "@/lib/telemetry/queries";

type Granularity = "day" | "week" | "month";
type RangeKey = "all" | "7d" | "30d" | "90d";

type TokenRow = {
  machine_id: string;
  agent: string;
  usage_date: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  reported_total_tokens: number;
  accounting_delta_tokens: number;
  reported_cost_usd: number | null;
};

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

function safeNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "No processed imports";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value + "T12:00:00Z"));
}

function formatPeriodLabel(value: string, granularity: Granularity) {
  if (granularity === "month") {
    const [year, month] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, 1)));
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(value + "T12:00:00Z"));
}

function niceCeiling(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  const nice =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

function summarize(rows: TokenRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.total += row.reported_total_tokens;
      acc.input += row.input_tokens;
      acc.output += row.output_tokens;
      acc.cache += row.cache_read_tokens;
      acc.cacheCreation += row.cache_creation_tokens;
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
      cacheCreation: 0,
      delta: 0,
      cost: 0,
      costRows: 0,
    },
  );
}

function subtractDays(value: string, days: number) {
  const date = new Date(value + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function Metric({
  label,
  value,
  detail,
  icon: Icon,
  accent,
  progress,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Gauge;
  accent: "cyan" | "violet" | "emerald" | "blue";
  progress?: number;
}) {
  const accentClass = {
    cyan: "text-cyan-300 bg-cyan-300/10 border-cyan-300/15",
    violet: "text-violet-300 bg-violet-300/10 border-violet-300/15",
    emerald: "text-emerald-300 bg-emerald-300/10 border-emerald-300/15",
    blue: "text-blue-300 bg-blue-300/10 border-blue-300/15",
  }[accent];

  const progressClass = {
    cyan: "bg-cyan-300",
    violet: "bg-violet-300",
    emerald: "bg-emerald-300",
    blue: "bg-blue-300",
  }[accent];

  return (
    <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
          {label}
        </p>
        <span
          className={
            "grid h-8 w-8 shrink-0 place-items-center rounded-lg border " +
            accentClass
          }
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-[1.7rem] font-semibold leading-none tracking-[-0.045em] text-slate-50">
        {value}
      </p>
      <p className="mt-2 min-h-4 text-[11px] leading-4 text-slate-500">
        {detail}
      </p>
      {progress !== undefined ? (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={"h-full rounded-full " + progressClass}
            style={{ width: Math.max(0, Math.min(100, progress)) + "%" }}
          />
        </div>
      ) : null}
    </div>
  );
}

const agentBarClasses = [
  "bg-violet-400",
  "bg-purple-400",
  "bg-cyan-400",
  "bg-sky-400",
  "bg-emerald-400",
];

export function DashboardView({
  rows,
  modelRows,
  machines,
  recentImports,
  collectionHints,
}: {
  rows: CurrentDailyUsageRow[];
  modelRows: CurrentDailyModelUsageRow[];
  machines: MachineRow[];
  recentImports: ImportRow[];
  collectionHints: MachineCollectionHint[];
}) {
  const router = useRouter();
  const [machine, setMachine] = useState("all");
  const [agent, setAgent] = useState("all");
  const [model, setModel] = useState("all");
  const [range, setRange] = useState<RangeKey>("all");
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [copied, setCopied] = useState(false);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

  const latestUsageDate = useMemo(
    () => [...rows.map((row) => row.usage_date)].sort().at(-1) ?? null,
    [rows],
  );

  const rangeStart = useMemo(() => {
    if (!latestUsageDate || range === "all") return null;
    const days = range === "7d" ? 6 : range === "30d" ? 29 : 89;
    return subtractDays(latestUsageDate, days);
  }, [latestUsageDate, range]);

  const agents = useMemo(
    () => [...new Set(rows.map((row) => row.agent))].sort(),
    [rows],
  );

  const scopedAgentRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (machine === "all" || row.machine_id === machine) &&
          (agent === "all" || row.agent === agent) &&
          (!rangeStart || row.usage_date >= rangeStart),
      ),
    [agent, machine, rangeStart, rows],
  );

  const models = useMemo(
    () =>
      [
        ...new Set(
          modelRows
            .filter(
              (row) =>
                (machine === "all" || row.machine_id === machine) &&
                (agent === "all" || row.agent === agent) &&
                (!rangeStart || row.usage_date >= rangeStart),
            )
            .map((row) => row.model),
        ),
      ].sort(),
    [agent, machine, modelRows, rangeStart],
  );

  const scopedModelRows = useMemo(
    () =>
      modelRows.filter(
        (row) =>
          (machine === "all" || row.machine_id === machine) &&
          (agent === "all" || row.agent === agent) &&
          (model === "all" || row.model === model) &&
          (!rangeStart || row.usage_date >= rangeStart),
      ),
    [agent, machine, model, modelRows, rangeStart],
  );

  const displayRows: TokenRow[] =
    model === "all" ? scopedAgentRows : scopedModelRows;
  const totals = useMemo(() => summarize(displayRows), [displayRows]);
  const agentTotals = useMemo(
    () => summarize(scopedAgentRows),
    [scopedAgentRows],
  );

  const allScopedModelRows = useMemo(
    () =>
      modelRows.filter(
        (row) =>
          (machine === "all" || row.machine_id === machine) &&
          (agent === "all" || row.agent === agent) &&
          (!rangeStart || row.usage_date >= rangeStart),
      ),
    [agent, machine, modelRows, rangeStart],
  );

  const modelComponentTotal = useMemo(
    () =>
      allScopedModelRows.reduce(
        (total, row) =>
          total +
          row.input_tokens +
          row.output_tokens +
          row.cache_read_tokens +
          row.cache_creation_tokens,
        0,
      ),
    [allScopedModelRows],
  );
  const agentComponentTotal =
    agentTotals.input +
    agentTotals.output +
    agentTotals.cache +
    agentTotals.cacheCreation;
  const modelCoverage = agentComponentTotal
    ? (modelComponentTotal / agentComponentTotal) * 100
    : 0;

  const byDay = useMemo(() => {
    const values = new Map<string, number>();
    for (const row of displayRows) {
      values.set(
        row.usage_date,
        (values.get(row.usage_date) ?? 0) + row.reported_total_tokens,
      );
    }
    return [...values.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({ date, total }));
  }, [displayRows]);

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

    for (const row of displayRows) {
      const key = periodKey(row.usage_date);
      values.set(key, (values.get(key) ?? 0) + row.reported_total_tokens);
    }

    return [...values.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({ date, total }));
  }, [displayRows, granularity]);

  const byAgent = useMemo(() => {
    const values = new Map<string, number>();
    for (const row of displayRows) {
      values.set(row.agent, (values.get(row.agent) ?? 0) + row.reported_total_tokens);
    }
    return [...values.entries()].sort((a, b) => b[1] - a[1]);
  }, [displayRows]);

  const byMachine = useMemo(() => {
    const values = new Map<string, number>();
    for (const row of displayRows) {
      values.set(
        row.machine_id,
        (values.get(row.machine_id) ?? 0) + row.reported_total_tokens,
      );
    }
    return [...values.entries()].sort((a, b) => b[1] - a[1]);
  }, [displayRows]);

  const topModels = useMemo(() => {
    const values = new Map<
      string,
      {
        model: string;
        total: number;
        input: number;
        output: number;
        cache: number;
        cacheCreation: number;
        cost: number;
        costRows: number;
        agents: Set<string>;
        days: Set<string>;
      }
    >();

    for (const row of scopedModelRows) {
      const current = values.get(row.model) ?? {
        model: row.model,
        total: 0,
        input: 0,
        output: 0,
        cache: 0,
        cacheCreation: 0,
        cost: 0,
        costRows: 0,
        agents: new Set<string>(),
        days: new Set<string>(),
      };
      current.total += row.reported_total_tokens;
      current.input += row.input_tokens;
      current.output += row.output_tokens;
      current.cache += row.cache_read_tokens;
      current.cacheCreation += row.cache_creation_tokens;
      if (row.reported_cost_usd !== null) {
        current.cost += row.reported_cost_usd;
        current.costRows += 1;
      }
      current.agents.add(row.agent);
      current.days.add(row.usage_date);
      values.set(row.model, current);
    }

    return [...values.values()].sort((a, b) => b.total - a.total).slice(0, 10);
  }, [scopedModelRows]);

  const modelAttributedTotal = scopedModelRows.reduce(
    (total, row) => total + row.reported_total_tokens,
    0,
  );

  const visibleImports = useMemo(
    () =>
      recentImports
        .filter((item) => machine === "all" || item.machine_id === machine)
        .slice(0, 3),
    [machine, recentImports],
  );

  const latestProcessed = recentImports.find(
    (item) => item.status === "processed",
  );

  const activeCollection =
    collectionHints.find((item) => item.id === machine) ??
    collectionHints[0] ??
    null;

  const chartMax = niceCeiling(
    Math.max(...byPeriod.map((period) => period.total), 1),
  );
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => ({
    ratio,
    value: chartMax * ratio,
  }));
  const labelEvery = Math.max(1, Math.ceil(byPeriod.length / 8));
  const cacheShare = totals.total ? (totals.cache / totals.total) * 100 : 0;
  const inputShare = totals.total ? (totals.input / totals.total) * 100 : 0;
  const outputShare = totals.total ? (totals.output / totals.total) * 100 : 0;
  const costCoverage = displayRows.length
    ? (totals.costRows / displayRows.length) * 100
    : 0;
  const activeDays = byDay.filter((item) => item.total > 0).length;
  const averageActiveDay = activeDays ? totals.total / activeDays : 0;
  const peakDay = [...byDay].sort((a, b) => b.total - a.total)[0] ?? null;

  async function copyCommand() {
    if (!activeCollection?.command) return;
    await navigator.clipboard.writeText(activeCollection.command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function backfillModels() {
    setBackfillBusy(true);
    setBackfillMessage(null);

    try {
      const response = await fetch("/api/models/backfill", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as {
        error?: string;
        insertedModelRows?: number;
        processedImports?: number;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Model backfill failed.");
      }

      setBackfillMessage(
        "Loaded " +
          Number(payload.insertedModelRows ?? 0).toLocaleString() +
          " model observations from " +
          Number(payload.processedImports ?? 0).toLocaleString() +
          " stored import(s).",
      );
      router.refresh();
    } catch (error) {
      setBackfillMessage(
        error instanceof Error ? error.message : "Model backfill failed.",
      );
    } finally {
      setBackfillBusy(false);
    }
  }

  return (
    <div className="min-w-0 pb-8">
      <header className="flex min-w-0 flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
            Global telemetry
          </p>
          <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-[-0.045em] text-slate-50 md:text-4xl">
            Token burn, without snapshot inflation.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Canonical daily truth with agent, model, cost and source detail.
          </p>
        </div>

        <div className="flex min-w-0 flex-col items-stretch gap-3 xl:items-end">
          <div className="flex items-center gap-2 self-start rounded-xl border border-white/10 bg-white/[0.025] px-3 py-2 text-xs text-slate-400 xl:self-end">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="whitespace-nowrap">Data up to</span>
            <strong className="whitespace-nowrap font-medium text-slate-200">
              {formatTimestamp(
                latestProcessed?.processed_at ?? latestProcessed?.created_at,
              )}
            </strong>
          </div>

          <div className="flex min-w-0 flex-wrap justify-start gap-2 xl:justify-end">
            <div
              role="group"
              aria-label="Time range"
              className="flex rounded-xl border border-white/10 bg-[#0b1722] p-1"
            >
              {(
                [
                  ["all", "All"],
                  ["90d", "90D"],
                  ["30d", "30D"],
                  ["7d", "7D"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={range === value}
                  onClick={() => setRange(value)}
                  className={[
                    "rounded-lg px-2.5 py-1.5 text-xs transition",
                    range === value
                      ? "bg-white/[0.09] text-white"
                      : "text-slate-500 hover:text-slate-300",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
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
                    "rounded-lg px-2.5 py-1.5 text-xs capitalize transition",
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
              onChange={(event) => {
                setMachine(event.target.value);
                setModel("all");
              }}
              className="h-10 min-w-0 rounded-xl border border-white/10 bg-[#0b1722] px-3 text-sm text-slate-300 outline-none ring-cyan-400 focus:ring-1"
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
              onChange={(event) => {
                setAgent(event.target.value);
                setModel("all");
              }}
              className="h-10 min-w-0 rounded-xl border border-white/10 bg-[#0b1722] px-3 text-sm text-slate-300 outline-none ring-cyan-400 focus:ring-1"
            >
              <option value="all">All agents</option>
              {agents.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={models.length === 0}
              className="h-10 min-w-0 max-w-[260px] rounded-xl border border-white/10 bg-[#0b1722] px-3 text-sm text-slate-300 outline-none ring-cyan-400 focus:ring-1 disabled:opacity-40"
            >
              <option value="all">All models</option>
              {models.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="mt-8 rounded-3xl border border-dashed border-white/15 bg-white/[0.025] px-6 py-16 text-center">
          <Database className="mx-auto h-8 w-8 text-slate-600" />
          <h2 className="mt-4 text-xl font-semibold">No accepted usage yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            Register a machine, then import your first pinned ccusage daily JSON.
          </p>
        </div>
      ) : (
        <>
          <section className="mt-7 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <Metric
              label={model === "all" ? "Total tokens" : "Model tokens"}
              value={compact(totals.total)}
              detail={
                model === "all"
                  ? totals.total.toLocaleString() + " exact"
                  : model
              }
              icon={Sigma}
              accent="cyan"
            />
            <Metric
              label="Cache read"
              value={compact(totals.cache)}
              detail={cacheShare.toFixed(1) + "% of selected total"}
              icon={Layers3}
              accent="emerald"
              progress={cacheShare}
            />
            <Metric
              label="Input tokens"
              value={compact(totals.input)}
              detail={inputShare.toFixed(1) + "% of selected total"}
              icon={Cpu}
              accent="violet"
              progress={inputShare}
            />
            <Metric
              label="Output tokens"
              value={compact(totals.output)}
              detail={outputShare.toFixed(1) + "% of selected total"}
              icon={Gauge}
              accent="cyan"
              progress={outputShare}
            />
            <Metric
              label="Models"
              value={String(models.length)}
              detail={
                modelRows.length
                  ? modelCoverage.toFixed(1) + "% component coverage"
                  : "Model detail not loaded"
              }
              icon={BarChart3}
              accent="blue"
              progress={modelRows.length ? modelCoverage : undefined}
            />
            <Metric
              label="ccusage cost"
              value={totals.costRows ? money(totals.cost) : "—"}
              detail={
                totals.costRows
                  ? totals.costRows + "/" + displayRows.length + " rows priced"
                  : "No reported cost data"
              }
              icon={CircleDollarSign}
              accent="violet"
              progress={costCoverage}
            />
          </section>

          <section className="mt-4 grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-6">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-100">
                    {granularity === "day"
                      ? "Daily token burn"
                      : granularity === "week"
                        ? "Weekly token burn"
                        : "Monthly token burn"}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {model === "all"
                      ? "Canonical tokens grouped from latest accepted rows"
                      : "Model-attributed canonical tokens for " + model}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-slate-500">
                  {byPeriod.length}{" "}
                  {granularity === "day"
                    ? "days"
                    : granularity === "week"
                      ? "weeks"
                      : "months"}
                </span>
              </div>

              <div className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)] gap-x-3">
                <div className="relative h-64">
                  {yTicks.map((tick) => (
                    <span
                      key={tick.ratio}
                      className="absolute right-0 -translate-y-1/2 text-[9px] tabular-nums text-slate-600"
                      style={{ top: (1 - tick.ratio) * 100 + "%" }}
                    >
                      {tick.ratio === 0 ? "0" : compact(tick.value)}
                    </span>
                  ))}
                </div>

                <div className="relative h-64 min-w-0">
                  {yTicks.map((tick) => (
                    <div
                      key={tick.ratio}
                      aria-hidden="true"
                      className="absolute inset-x-0 border-t border-dashed border-white/[0.06]"
                      style={{ top: (1 - tick.ratio) * 100 + "%" }}
                    />
                  ))}
                  <div
                    className="absolute inset-0 grid min-w-0 items-end gap-[2px]"
                    style={{
                      gridTemplateColumns:
                        "repeat(" + byPeriod.length + ", minmax(0, 1fr))",
                    }}
                  >
                    {byPeriod.map((period) => {
                      const height =
                        period.total === 0
                          ? 0
                          : Math.max(1.5, (period.total / chartMax) * 100);
                      return (
                        <div
                          key={period.date}
                          className="group flex h-full min-w-0 items-end"
                          role="img"
                          aria-label={
                            period.date +
                            ": " +
                            period.total.toLocaleString() +
                            " reported tokens"
                          }
                          title={
                            formatPeriodLabel(period.date, granularity) +
                            ": " +
                            period.total.toLocaleString() +
                            " tokens"
                          }
                        >
                          <div
                            className="w-full rounded-t-[3px] bg-cyan-300/75 transition group-hover:bg-cyan-200"
                            style={{ height: height + "%" }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div />
                <div
                  className="mt-2 grid min-w-0 gap-[2px]"
                  style={{
                    gridTemplateColumns:
                      "repeat(" + byPeriod.length + ", minmax(0, 1fr))",
                  }}
                >
                  {byPeriod.map((period, index) => (
                    <span
                      key={period.date}
                      className="min-w-0 text-center text-[9px] text-slate-600"
                    >
                      {index % labelEvery === 0 || index === byPeriod.length - 1
                        ? formatPeriodLabel(period.date, granularity)
                        : ""}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-6">
              <h2 className="font-semibold text-slate-100">Agent share</h2>
              <p className="mt-1 text-xs text-slate-500">
                True share of the selected token total
              </p>

              <div className="mt-6 space-y-5">
                {byAgent.map(([name, value], index) => {
                  const share = totals.total ? (value / totals.total) * 100 : 0;
                  return (
                    <div key={name}>
                      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                        <span className="truncate capitalize text-slate-300">
                          {name}
                        </span>
                        <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
                          <span className="text-slate-400">{compact(value)}</span>
                          <span className="w-12 text-right text-slate-600">
                            {share.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className={
                            "h-full rounded-full " +
                            agentBarClasses[index % agentBarClasses.length]
                          }
                          style={{
                            width: share + "%",
                            minWidth: value > 0 ? "2px" : undefined,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="mt-4 grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1.55fr)_340px]">
            <div className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.035] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-100">Model usage</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Per-model attribution from ccusage modelBreakdowns
                  </p>
                </div>
                {modelRows.length ? (
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-slate-500">
                    {models.length} models · {modelCoverage.toFixed(1)}% covered
                  </span>
                ) : null}
              </div>

              {modelRows.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed border-cyan-300/20 bg-cyan-300/[0.035] p-5">
                  <p className="text-sm font-medium text-slate-200">
                    Model detail is still in the preserved raw snapshot.
                  </p>
                  <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-500">
                    Load it from the private raw import. This enriches model
                    analytics only; the certified canonical token total is not
                    re-added or changed.
                  </p>
                  <button
                    type="button"
                    onClick={backfillModels}
                    disabled={backfillBusy}
                    className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-cyan-300 px-3 text-xs font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-50"
                  >
                    {backfillBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Database className="h-3.5 w-3.5" />
                    )}
                    Load model details
                  </button>
                  {backfillMessage ? (
                    <p className="mt-3 text-xs text-slate-400">
                      {backfillMessage}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-[0.12em] text-slate-600">
                      <tr>
                        <th className="pb-3 font-medium">Model</th>
                        <th className="pb-3 font-medium">Agent</th>
                        <th className="pb-3 text-right font-medium">Tokens</th>
                        <th className="pb-3 text-right font-medium">Share</th>
                        <th className="pb-3 text-right font-medium">Cache</th>
                        <th className="pb-3 text-right font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {topModels.map((item) => {
                        const share = modelAttributedTotal
                          ? (item.total / modelAttributedTotal) * 100
                          : 0;
                        const cacheShareForModel = item.total
                          ? (item.cache / item.total) * 100
                          : 0;
                        return (
                          <tr key={item.model}>
                            <td className="max-w-[300px] py-3 pr-4">
                              <button
                                type="button"
                                onClick={() => setModel(item.model)}
                                className="block max-w-full truncate font-mono text-[11px] font-medium text-slate-200 transition hover:text-cyan-300"
                                title={item.model}
                              >
                                {item.model}
                              </button>
                              <span className="mt-1 block text-[10px] text-slate-600">
                                {item.days.size} active day
                                {item.days.size === 1 ? "" : "s"}
                              </span>
                            </td>
                            <td className="py-3 pr-4 capitalize text-slate-400">
                              {[...item.agents].join(", ")}
                            </td>
                            <td className="py-3 text-right tabular-nums text-slate-300">
                              {compact(item.total)}
                            </td>
                            <td className="py-3 text-right tabular-nums text-slate-500">
                              {share.toFixed(1)}%
                            </td>
                            <td className="py-3 text-right tabular-nums text-slate-500">
                              {cacheShareForModel.toFixed(1)}%
                            </td>
                            <td className="py-3 text-right tabular-nums text-slate-400">
                              {item.costRows ? money(item.cost) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.035] p-5">
              <h2 className="font-semibold text-slate-100">Usage detail</h2>
              <p className="mt-1 text-xs text-slate-500">
                Selected scope at a glance
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3">
                {[
                  ["Active days", activeDays.toLocaleString()],
                  ["Avg / active day", compact(averageActiveDay)],
                  ["Peak day", peakDay ? compact(peakDay.total) : "—"],
                  ["Peak date", peakDay ? formatDate(peakDay.date) : "—"],
                  ["Agents", String(byAgent.length)],
                  ["Machines", String(byMachine.length)],
                  [
                    "Model coverage",
                    modelRows.length ? modelCoverage.toFixed(1) + "%" : "—",
                  ],
                  ["Accounting delta", compact(totals.delta)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-white/[0.07] bg-black/15 p-3"
                  >
                    <p className="text-[10px] uppercase tracking-[0.1em] text-slate-600">
                      {label}
                    </p>
                    <p className="mt-1.5 text-sm font-medium tabular-nums text-slate-300">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-4 grid min-w-0 gap-4 xl:grid-cols-2 2xl:grid-cols-[.9fr_1.25fr_.9fr]">
            <div className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.035] p-5">
              <div className="mb-5">
                <h2 className="font-semibold text-slate-100">
                  Machine contribution
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Physical sources contributing to this view
                </p>
              </div>
              <div className="space-y-3">
                {byMachine.map(([id, value]) => {
                  const machineRow = machines.find((item) => item.id === id);
                  const share = totals.total ? (value / totals.total) * 100 : 0;
                  return (
                    <div
                      key={id}
                      className="rounded-2xl border border-white/[0.08] bg-black/15 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-200">
                            {machineRow?.name ?? id}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-600">
                            {share.toFixed(1)}% of selected total
                          </p>
                        </div>
                        <span className="shrink-0 text-sm tabular-nums text-slate-400">
                          {compact(value)}
                        </span>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full bg-emerald-400/80"
                          style={{ width: share + "%" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.035] p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-100">Recent imports</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Latest snapshot outcomes
                  </p>
                </div>
                <a
                  href="/imports"
                  className="text-xs font-medium text-cyan-300 transition hover:text-cyan-200"
                >
                  View all
                </a>
              </div>

              <div className="divide-y divide-white/[0.06]">
                {visibleImports.length ? (
                  visibleImports.map((item) => {
                    const machineRow = machines.find(
                      (entry) => entry.id === item.machine_id,
                    );
                    const netChange = safeNumber(item.summary?.netChange);
                    return (
                      <div
                        key={item.id}
                        className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-4 py-3 first:pt-0"
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                            <p className="truncate text-sm font-medium text-slate-300">
                              {machineRow?.name ?? item.machine_id}
                            </p>
                          </div>
                          <p className="mt-1 truncate pl-6 text-[11px] text-slate-600">
                            {item.scope_start && item.scope_end
                              ? item.scope_start + " → " + item.scope_end
                              : "Scope unavailable"}
                            {" · "}
                            {formatTimestamp(item.created_at)}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="rounded-full border border-emerald-400/15 bg-emerald-400/[0.07] px-2 py-1 text-[10px] text-emerald-300">
                            {item.status}
                          </span>
                          <p className="mt-2 text-xs tabular-nums text-slate-500">
                            {netChange === null
                              ? "—"
                              : (netChange >= 0 ? "+" : "") + compact(netChange)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="py-6 text-sm text-slate-500">
                    No imports match this machine filter.
                  </p>
                )}
              </div>
            </div>

            <div className="min-w-0 rounded-3xl border border-white/10 bg-white/[0.035] p-5 xl:col-span-2 2xl:col-span-1">
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-violet-300/15 bg-violet-300/10 text-violet-300">
                  <Clock3 className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-100">
                    Recommended collection
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {activeCollection
                      ? "Three-day reconciliation overlap"
                      : "No machine available"}
                  </p>
                </div>
              </div>

              {activeCollection ? (
                <>
                  <div className="mt-4 rounded-xl border border-white/[0.08] bg-black/20 p-3">
                    <code className="block break-all text-[11px] leading-5 text-slate-300">
                      {activeCollection.command}
                    </code>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 text-[11px] leading-5 text-slate-600">
                      <p className="truncate">{activeCollection.name}</p>
                      <p>
                        Next since:{" "}
                        <span className="text-emerald-300">
                          {activeCollection.nextSince ?? "full history"}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={copyCommand}
                      className="flex shrink-0 items-center gap-2 rounded-lg border border-white/10 px-2.5 py-2 text-xs text-slate-400 transition hover:bg-white/[0.05] hover:text-slate-200"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </>
              ) : null}
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
