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
  Info,
  Layers3,
  Loader2,
  Sigma,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  ALL_MACHINES,
  LOST_WINDOWS_PC_MACHINE_ID,
  LOST_WINDOWS_PC_MACHINE_NAME,
  selectUnifiedUsage,
  summarizeUnifiedUsage,
} from "@/lib/telemetry/unified-usage";
import type {
  UnifiedModelUsageRow,
  UnifiedUsageProjection,
  UnifiedUsageSelection,
} from "@/lib/telemetry/unified-usage";
import type {
  ImportRow,
  MachineCollectionHint,
  MachineRow,
} from "@/lib/telemetry/queries";

type Granularity = "day" | "week" | "month";
type RangeKey = "all" | "7d" | "30d" | "90d";

type ChartRow = {
  period: string;
  machineId: string;
  agent: string;
  sourceKind: "canonical" | "recovered";
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  accountingDeltaTokens: number;
  reportedCostUsd: number | null;
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

function weekStart(value: string) {
  const date = new Date(value + "T12:00:00Z");
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + mondayOffset);
  return date.toISOString().slice(0, 10);
}

function niceCeiling(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  const nice =
    fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
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
    cyan: "text-blue-600 bg-blue-50 border-blue-100",
    violet: "text-violet-600 bg-violet-50 border-violet-100",
    emerald: "text-emerald-600 bg-emerald-50 border-emerald-100",
    blue: "text-sky-600 bg-sky-50 border-sky-100",
  }[accent];

  const progressClass = {
    cyan: "bg-blue-500",
    violet: "bg-violet-500",
    emerald: "bg-emerald-500",
    blue: "bg-sky-500",
  }[accent];

  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.025)] p-4">
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
      <p className="mt-3 text-[1.7rem] font-semibold leading-none tracking-[-0.045em] text-slate-950">
        {value}
      </p>
      <p className="mt-2 min-h-4 text-[11px] leading-4 text-slate-500">
        {detail}
      </p>
      {progress !== undefined ? (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-100">
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
  "bg-violet-500",
  "bg-purple-500",
  "bg-cyan-500",
  "bg-sky-500",
  "bg-emerald-500",
];

function toChartRows(
  selection: Extract<UnifiedUsageSelection, { status: "ready" }>,
  granularity: Granularity,
): ChartRow[] {
  if (granularity === "month") {
    return selection.monthlyRows.map((row) => ({
      period: row.month,
      machineId: row.machineId,
      agent: row.agent,
      sourceKind: row.sourceKind,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
      totalTokens: row.totalTokens,
      accountingDeltaTokens: row.accountingDeltaTokens,
      reportedCostUsd: row.reportedCostUsd,
    }));
  }

  const dailyRows = selection.dailyRows.map((row) => ({
    period: row.usageDate,
    machineId: row.machineId,
    agent: row.agent,
    sourceKind: row.sourceKind,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    cacheReadTokens: row.cacheReadTokens,
    totalTokens: row.totalTokens,
    accountingDeltaTokens: row.accountingDeltaTokens,
    reportedCostUsd: row.reportedCostUsd,
  }));

  if (granularity === "day") return dailyRows;

  const values = new Map<string, ChartRow>();
  for (const row of dailyRows) {
    const period = weekStart(row.period);
    const key = [period, row.machineId, row.agent].join("|");
    const current = values.get(key);
    if (!current) {
      values.set(key, { ...row, period });
      continue;
    }
    values.set(key, {
      ...current,
      inputTokens: current.inputTokens + row.inputTokens,
      outputTokens: current.outputTokens + row.outputTokens,
      cacheCreationTokens:
        current.cacheCreationTokens + row.cacheCreationTokens,
      cacheReadTokens: current.cacheReadTokens + row.cacheReadTokens,
      totalTokens: current.totalTokens + row.totalTokens,
      accountingDeltaTokens:
        current.accountingDeltaTokens + row.accountingDeltaTokens,
      reportedCostUsd:
        current.reportedCostUsd === null || row.reportedCostUsd === null
          ? current.reportedCostUsd ?? row.reportedCostUsd
          : current.reportedCostUsd + row.reportedCostUsd,
    });
  }
  return [...values.values()].sort((a, b) => a.period.localeCompare(b.period));
}

type ModelSummary = {
  key: string;
  label: string;
  kind: UnifiedModelUsageRow["kind"];
  total: number;
  input: number;
  output: number;
  cache: number;
  cacheCreation: number;
  cost: number;
  costRows: number;
  agents: Set<string>;
  periods: Set<string>;
  knownModels: string[];
};

function summarizeModelRows(rows: UnifiedModelUsageRow[]) {
  const values = new Map<string, ModelSummary>();

  for (const row of rows) {
    const key =
      row.kind === "canonical-attributed"
        ? `canonical:${row.model}`
        : row.kind === "canonical-unattributed"
          ? `canonical-unattributed:${row.machineId}:${row.agent}`
          : `recovered:${row.agent}:${row.month}`;
    const label =
      row.kind === "canonical-attributed"
        ? row.model
        : row.kind === "canonical-unattributed"
          ? `Canonical / ${row.agent} / model attribution unavailable`
          : `Recovered / ${row.agent} / ${row.month}`;
    const current = values.get(key) ?? {
      key,
      label,
      kind: row.kind,
      total: 0,
      input: 0,
      output: 0,
      cache: 0,
      cacheCreation: 0,
      cost: 0,
      costRows: 0,
      agents: new Set<string>(),
      periods: new Set<string>(),
      knownModels: [],
    };
    current.total += row.totalTokens;
    current.input += row.inputTokens;
    current.output += row.outputTokens;
    current.cache += row.cacheReadTokens;
    current.cacheCreation += row.cacheCreationTokens;
    if (row.reportedCostUsd !== null) {
      current.cost += row.reportedCostUsd;
      current.costRows += 1;
    }
    current.agents.add(row.agent);
    current.periods.add(
      row.kind === "canonical-attributed"
        ? row.usageDate
        : row.kind === "canonical-unattributed"
          ? row.usageDate
          : row.month,
    );
    if (row.kind === "recovered-unattributed") {
      current.knownModels = [...row.knownModels];
    }
    values.set(key, current);
  }

  return [...values.values()].sort((a, b) => b.total - a.total);
}

export function DashboardView({
  projection,
  machines,
  recentImports,
  collectionHints,
}: {
  projection: UnifiedUsageProjection;
  machines: MachineRow[];
  recentImports: ImportRow[];
  collectionHints: MachineCollectionHint[];
}) {
  const router = useRouter();
  const [machine, setMachine] = useState(ALL_MACHINES);
  const [agent, setAgent] = useState("all");
  const [model, setModel] = useState("all");
  const [range, setRange] = useState<RangeKey>("all");
  const [granularity, setGranularity] = useState<Granularity>("month");
  const [copied, setCopied] = useState(false);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);

  const agents = useMemo(
    () =>
      [...new Set(
        projection.monthlyRows
          .map((row) => row.agent)
          .filter((item) => item !== "All"),
      )].sort(),
    [projection.monthlyRows],
  );

  const models = useMemo(
    () =>
      [...new Set(
        projection.modelRows
          .filter(
            (row): row is Extract<
              UnifiedModelUsageRow,
              { kind: "canonical-attributed" }
            > =>
              row.kind === "canonical-attributed" &&
              (machine === ALL_MACHINES || row.machineId === machine) &&
              (agent === "all" || row.agent === agent),
          )
          .map((row) => row.model),
      )].sort(),
    [agent, machine, projection.modelRows],
  );

  const requestedSelection = useMemo(
    () =>
      selectUnifiedUsage(projection, {
        machineId: machine,
        agent,
        model,
        range,
        granularity,
      }),
    [agent, granularity, machine, model, projection, range],
  );
  const recoveredInScope = requestedSelection.recoveredInScope;
  const activeGranularity: Granularity = recoveredInScope ? "month" : granularity;
  const activeRange: RangeKey = recoveredInScope ? "all" : range;

  useEffect(() => {
    if (recoveredInScope) {
      if (granularity !== "month") setGranularity("month");
      if (range !== "all") setRange("all");
    }
  }, [granularity, range, recoveredInScope]);

  const selectedResult = useMemo(
    () =>
      selectUnifiedUsage(projection, {
        machineId: machine,
        agent,
        model,
        range: activeRange,
        granularity: activeGranularity,
      }),
    [activeGranularity, activeRange, agent, machine, model, projection],
  );

  const selection = useMemo(
    () =>
      selectedResult.status === "ready"
        ? selectedResult
        : {
            status: "ready" as const,
            dailyRows: [],
            monthlyRows: [],
            modelRows: [],
            totals: summarizeUnifiedUsage([]),
            recoveredInScope: selectedResult.recoveredInScope,
            modelAttributionExcluded: selectedResult.modelAttributionExcluded,
            supportsDayWeek: selectedResult.supportsDayWeek,
            supportsRollingRanges: selectedResult.supportsRollingRanges,
            effectiveRange: activeRange,
          },
    [activeRange, selectedResult],
  );
  const displayRows = useMemo(
    () => toChartRows(selection, activeGranularity),
    [activeGranularity, selection],
  );
  const totals = {
    total: selection.totals.totalTokens,
    input: selection.totals.inputTokens,
    output: selection.totals.outputTokens,
    cache: selection.totals.cacheReadTokens,
    cacheCreation: selection.totals.cacheCreationTokens,
    delta: selection.totals.accountingDeltaTokens,
    cost: selection.totals.reportedCostUsd,
    costRows: selection.totals.costRows,
  };
  const modelRows = selection.modelRows;
  const canonicalModelRows = modelRows.filter(
    (row): row is Extract<
      UnifiedModelUsageRow,
      { kind: "canonical-attributed" }
    > => row.kind === "canonical-attributed",
  );
  const topModels = useMemo(
    () => summarizeModelRows(modelRows),
    [modelRows],
  );
  const modelAttributedTotal = totals.total;
  const modelComponentTotal = canonicalModelRows.reduce(
    (total, row) =>
      total +
      row.inputTokens +
      row.outputTokens +
      row.cacheReadTokens +
      row.cacheCreationTokens,
    0,
  );
  const modelCoverage = selection.totals.componentTotalTokens
    ? (modelComponentTotal / selection.totals.componentTotalTokens) * 100
    : 0;

  const byDay = useMemo(() => {
    const values = new Map<string, number>();
    for (const row of selection.dailyRows) {
      values.set(row.usageDate, (values.get(row.usageDate) ?? 0) + row.totalTokens);
    }
    return [...values.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({ date, total }));
  }, [selection.dailyRows]);

  const byPeriod = useMemo(() => {
    const values = new Map<string, number>();

    for (const row of displayRows) {
      values.set(row.period, (values.get(row.period) ?? 0) + row.totalTokens);
    }

    return [...values.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, total]) => ({ date, total }));
  }, [displayRows]);

  const byAgent = useMemo(() => {
    const values = new Map<string, number>();
    for (const row of displayRows) {
      values.set(row.agent, (values.get(row.agent) ?? 0) + row.totalTokens);
    }
    return [...values.entries()].sort((a, b) => b[1] - a[1]);
  }, [displayRows]);

  const byMachine = useMemo(() => {
    const values = new Map<string, number>();
    for (const row of displayRows) {
      values.set(row.machineId, (values.get(row.machineId) ?? 0) + row.totalTokens);
    }
    return [...values.entries()].sort((a, b) => b[1] - a[1]);
  }, [displayRows]);

  const visibleImports = useMemo(
    () =>
      recentImports
        .filter((item) => machine === ALL_MACHINES || item.machine_id === machine)
        .slice(0, 3),
    [machine, recentImports],
  );

  const latestProcessed = recentImports.find(
    (item) => item.status === "processed",
  );
  const activeCollection =
    machine === ALL_MACHINES
      ? collectionHints[0] ?? null
      : collectionHints.find((item) => item.id === machine) ?? null;

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
  const costCoverage = selection.totals.rowCount
    ? (totals.costRows / selection.totals.rowCount) * 100
    : 0;
  const detailedTotal = selection.dailyRows.reduce(
    (total, row) => total + row.totalTokens,
    0,
  );
  const detailedDays = byDay.filter((item) => item.total > 0).length;
  const averageDetailedDay = detailedDays ? detailedTotal / detailedDays : 0;
  const peakDay = [...byDay].sort((a, b) => b.total - a.total)[0] ?? null;
  const hasUsage = selection.totals.rowCount > 0;

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

  if (selectedResult.status === "unsupported") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Daily and weekly detail is unavailable for the recovered lost-PC history.
        Select Month and All to view its exact monthly totals.
      </div>
    );
  }

  return (
    <div className="min-w-0 pb-8">
      <header className="flex min-w-0 flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
            Global telemetry
          </p>
          <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-[-0.045em] text-slate-950 md:text-4xl">
            Token burn, without snapshot inflation.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            One view of every known token, with precision matched to the surviving evidence.
          </p>
        </div>

        <div className="flex min-w-0 flex-col items-stretch gap-3 xl:items-end">
          <div className="flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 xl:self-end">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span className="whitespace-nowrap">Data up to</span>
            <strong className="whitespace-nowrap font-medium text-slate-800">
              {formatTimestamp(
                latestProcessed?.processed_at ?? latestProcessed?.created_at,
              )}
            </strong>
          </div>

          <div className="flex min-w-0 flex-wrap justify-start gap-2 xl:justify-end">
            <div
              role="group"
              aria-label="Time range"
              className="flex rounded-xl border border-slate-200 bg-white p-1"
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
                  aria-pressed={activeRange === value}
                  aria-disabled={recoveredInScope && value !== "all"}
                  disabled={recoveredInScope && value !== "all"}
                  title={
                    recoveredInScope && value !== "all"
                      ? "Rolling ranges are unavailable for recovered monthly history."
                      : undefined
                  }
                  onClick={() => setRange(value)}
                  className={[
                    "rounded-lg px-2.5 py-1.5 text-xs transition",
                    activeRange === value
                      ? "bg-blue-50 text-blue-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              role="group"
              aria-label="Aggregation granularity"
              className="flex rounded-xl border border-slate-200 bg-white p-1"
            >
              {(["day", "week", "month"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={activeGranularity === value}
                  aria-disabled={recoveredInScope && value !== "month"}
                  disabled={recoveredInScope && value !== "month"}
                  title={
                    recoveredInScope && value !== "month"
                      ? "Daily and weekly detail is unavailable for recovered monthly history."
                      : undefined
                  }
                  onClick={() => setGranularity(value)}
                  className={[
                    "rounded-lg px-2.5 py-1.5 text-xs capitalize transition",
                    activeGranularity === value
                      ? "bg-blue-50 text-blue-700 shadow-sm"
                      : "text-slate-500 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40",
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
              className="h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none ring-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">All machines</option>
              {machines.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
              {projection.recoveredSet ? (
                <option value={LOST_WINDOWS_PC_MACHINE_ID}>
                  {LOST_WINDOWS_PC_MACHINE_NAME}
                </option>
              ) : null}
            </select>
            <select
              aria-label="Filter by agent"
              value={agent}
              onChange={(event) => {
                setAgent(event.target.value);
                setModel("all");
              }}
              className="h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none ring-blue-400 focus:ring-2 focus:ring-blue-100"
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
              className="h-10 min-w-0 max-w-[260px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none ring-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-40"
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

      {recoveredInScope ? (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs leading-5 text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Lost Windows PC history is included at exact monthly and agent
            granularity. Daily and weekly detail is unavailable for this
            recovered history. Reported cost may be incomplete for some
            recovered models.
          </p>
        </div>
      ) : null}
      {selection.modelAttributionExcluded ? (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <p>
            Recovered lost-PC usage is excluded from this model-specific view
            because per-model token attribution is unavailable.
          </p>
        </div>
      ) : null}

      {!hasUsage ? (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
          <Database className="mx-auto h-8 w-8 text-slate-500" />
          <h2 className="mt-4 text-xl font-semibold">No accepted usage yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            Register a machine, then import your first pinned ccusage daily JSON.
          </p>
        </div>
      ) : (
        <>
          <section className="mt-7 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-7">
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
              label="Cache create"
              value={compact(totals.cacheCreation)}
              detail={
                totals.total
                  ? ((totals.cacheCreation / totals.total) * 100).toFixed(1) +
                    "% of selected total"
                  : "No cache creation tokens"
              }
              icon={Database}
              accent="blue"
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
              label="Attributed models"
              value={String(models.length)}
              detail={
                models.length
                  ? modelCoverage.toFixed(1) + "% component coverage"
                  : recoveredInScope
                    ? "Recovered model names only"
                    : "Model detail not loaded"
              }
              icon={BarChart3}
              accent="blue"
              progress={modelRows.length ? modelCoverage : undefined}
            />
            <Metric
              label="Reported cost"
              value={totals.costRows ? money(totals.cost) : "—"}
              detail={
                totals.costRows
                  ? totals.costRows + " reported rows with cost"
                  : "No reported cost data"
              }
              icon={CircleDollarSign}
              accent="violet"
              progress={costCoverage}
            />
          </section>

          {selection.totals.pricingComplete ? null : (
            <p className="mt-3 text-xs text-amber-700">
              {recoveredInScope
                ? "Reported cost is incomplete for some recovered models."
                : "Reported cost is unavailable for some selected rows."}
            </p>
          )}

          <section className="mt-4 grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.025)] p-5 md:p-6">
              <div className="mb-5 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">
                    {activeGranularity === "day"
                      ? "Daily token burn"
                      : activeGranularity === "week"
                        ? "Weekly token burn"
                        : "Monthly token burn"}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {model === "all"
                      ? "Canonical detailed rows plus exact recovered monthly rows"
                      : "Model-attributed canonical tokens for " + model}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-slate-200 px-2.5 py-1 text-[10px] uppercase tracking-wider text-slate-500">
                  {byPeriod.length}{" "}
                  {activeGranularity === "day"
                    ? "days"
                    : activeGranularity === "week"
                      ? "weeks"
                      : "months"}
                </span>
              </div>

              <div className="grid min-w-0 grid-cols-[44px_minmax(0,1fr)] gap-x-3">
                <div className="relative h-64">
                  {yTicks.map((tick) => (
                    <span
                      key={tick.ratio}
                      className="absolute right-0 -translate-y-1/2 text-[9px] tabular-nums text-slate-500"
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
                      className="absolute inset-x-0 border-t border-dashed border-slate-200"
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
                            formatPeriodLabel(period.date, activeGranularity) +
                            ": " +
                            period.total.toLocaleString() +
                            " tokens"
                          }
                        >
                          <div
                            className="w-full rounded-t-[3px] bg-blue-500/80 transition group-hover:bg-blue-600"
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
                      className="min-w-0 text-center text-[9px] text-slate-500"
                    >
                      {index % labelEvery === 0 || index === byPeriod.length - 1
                        ? formatPeriodLabel(period.date, activeGranularity)
                        : ""}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="min-w-0 rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.025)] p-5 md:p-6">
              <h2 className="font-semibold text-slate-900">Agent share</h2>
              <p className="mt-1 text-xs text-slate-500">
                True share of the selected token total
              </p>

              <div className="mt-6 space-y-5">
                {byAgent.map(([name, value], index) => {
                  const share = totals.total ? (value / totals.total) * 100 : 0;
                  return (
                    <div key={name}>
                      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                        <span className="truncate capitalize text-slate-700">
                          {name}
                        </span>
                        <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
                          <span className="text-slate-500">{compact(value)}</span>
                          <span className="w-12 text-right text-slate-500">
                            {share.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
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
            <div className="min-w-0 rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.025)] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">Model usage</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Canonical model attribution plus recovered evidence buckets
                  </p>
                </div>
                {modelRows.length ? (
                  <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[10px] uppercase tracking-wider text-slate-500">
                    {models.length} attributed models · {modelCoverage.toFixed(1)}% of components
                  </span>
                ) : null}
              </div>

              {canonicalModelRows.length === 0 && modelRows.length === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed border-blue-200 bg-blue-50/70 p-5">
                  <p className="text-sm font-medium text-slate-800">
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
                    className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    {backfillBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Database className="h-3.5 w-3.5" />
                    )}
                    Load model details
                  </button>
                  {backfillMessage ? (
                    <p className="mt-3 text-xs text-slate-500">
                      {backfillMessage}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-[0.12em] text-slate-500">
                      <tr>
                        <th className="pb-3 font-medium">Model</th>
                        <th className="pb-3 font-medium">Agent</th>
                        <th className="pb-3 text-right font-medium">Tokens</th>
                        <th className="pb-3 text-right font-medium">Share</th>
                        <th className="pb-3 text-right font-medium">Cache</th>
                        <th className="pb-3 text-right font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {topModels.map((item) => {
                        const share = modelAttributedTotal
                          ? (item.total / modelAttributedTotal) * 100
                          : 0;
                        const cacheShareForModel = item.total
                          ? (item.cache / item.total) * 100
                          : 0;
                        return (
                          <tr key={item.key}>
                            <td className="max-w-[300px] py-3 pr-4">
                              {item.kind === "canonical-attributed" ? (
                                <button
                                  type="button"
                                  onClick={() => setModel(item.label)}
                                  className="block max-w-full truncate font-mono text-[11px] font-medium text-slate-800 transition hover:text-blue-600"
                                  title={item.label}
                                >
                                  {item.label}
                                </button>
                              ) : (
                                <p className="font-medium text-slate-800">
                                  {item.label}
                                </p>
                              )}
                              <span className="mt-1 block text-[10px] text-slate-500">
                                {item.kind === "canonical-attributed"
                                  ? item.periods.size +
                                    " detailed day" +
                                    (item.periods.size === 1 ? "" : "s")
                                  : "Attribution unavailable"}
                              </span>
                              {item.kind === "recovered-unattributed" ? (
                                <span className="mt-1 block text-[10px] leading-4 text-slate-500">
                                  Known models: {item.knownModels.join(", ") || "not listed"}
                                </span>
                              ) : null}
                            </td>
                            <td className="py-3 pr-4 capitalize text-slate-500">
                              {[...item.agents].join(", ")}
                            </td>
                            <td className="py-3 text-right tabular-nums text-slate-700">
                              {compact(item.total)}
                            </td>
                            <td className="py-3 text-right tabular-nums text-slate-500">
                              {share.toFixed(1)}%
                            </td>
                            <td className="py-3 text-right tabular-nums text-slate-500">
                              {cacheShareForModel.toFixed(1)}%
                            </td>
                            <td className="py-3 text-right tabular-nums text-slate-500">
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

            <div className="min-w-0 rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.025)] p-5">
              <h2 className="font-semibold text-slate-900">Usage detail</h2>
              <p className="mt-1 text-xs text-slate-500">
                Selected scope at a glance; daily metrics use detailed telemetry only
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3">
                {[
                  ["Detailed days", detailedDays.toLocaleString()],
                  ["Avg / detailed day", compact(averageDetailedDay)],
                  ["Peak detailed day", peakDay ? compact(peakDay.total) : "—"],
                  [
                    "Peak detailed date",
                    peakDay ? formatDate(peakDay.date) : "—",
                  ],
                  ["Agents", String(byAgent.length)],
                  ["Machines", String(byMachine.length)],
                  [
                    "Model coverage",
                    canonicalModelRows.length
                      ? modelCoverage.toFixed(1) + "%"
                      : "Unattributed",
                  ],
                  ["Accounting delta", compact(totals.delta)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
                  >
                    <p className="text-[10px] uppercase tracking-[0.1em] text-slate-500">
                      {label}
                    </p>
                    <p className="mt-1.5 text-sm font-medium tabular-nums text-slate-700">
                      {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-4 grid min-w-0 gap-4 xl:grid-cols-2 2xl:grid-cols-[.9fr_1.25fr_.9fr]">
            <div className="min-w-0 rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.025)] p-5">
              <div className="mb-5">
                <h2 className="font-semibold text-slate-900">
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
                  const machineName =
                    id === LOST_WINDOWS_PC_MACHINE_ID
                      ? LOST_WINDOWS_PC_MACHINE_NAME
                      : machineRow?.name ?? id;
                  return (
                    <div
                      key={id}
                      className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-800">
                            {machineName}
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">
                            {share.toFixed(1)}% of selected total
                            {id === LOST_WINDOWS_PC_MACHINE_ID
                              ? " · exact monthly history"
                              : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm tabular-nums text-slate-500">
                          {compact(value)}
                        </span>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-emerald-500/80"
                          style={{ width: share + "%" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="min-w-0 rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.025)] p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-900">Recent imports</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Latest snapshot outcomes
                  </p>
                </div>
                <a
                  href="/imports"
                  className="text-xs font-medium text-blue-600 transition hover:text-blue-600"
                >
                  View all
                </a>
              </div>

              <div className="divide-y divide-slate-100">
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
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                            <p className="truncate text-sm font-medium text-slate-700">
                              {machineRow?.name ?? item.machine_id}
                            </p>
                          </div>
                          <p className="mt-1 truncate pl-6 text-[11px] text-slate-500">
                            {item.scope_start && item.scope_end
                              ? item.scope_start + " → " + item.scope_end
                              : "Scope unavailable"}
                            {" · "}
                            {formatTimestamp(item.created_at)}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] text-emerald-600">
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

            <div className="min-w-0 rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.025)] p-5 xl:col-span-2 2xl:col-span-1">
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-violet-100 bg-violet-50 text-violet-600">
                  <Clock3 className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-900">
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
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <code className="block break-all text-[11px] leading-5 text-slate-700">
                      {activeCollection.command}
                    </code>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 text-[11px] leading-5 text-slate-500">
                      <p className="truncate">{activeCollection.name}</p>
                      <p>
                        Next since:{" "}
                        <span className="text-emerald-600">
                          {activeCollection.nextSince ?? "full history"}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={copyCommand}
                      className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-600 transition hover:bg-slate-50 hover:text-slate-800"
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
            <p className="mt-4 text-xs text-slate-500">
              Accounting delta preserved from ccusage: {compact(totals.delta)}.
              It is intentionally not assigned a semantic meaning.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
