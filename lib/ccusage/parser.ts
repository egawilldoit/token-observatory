import { usageHash } from "./hash";
import type {
  DailyUsageObservationInput,
  ParsedCcusageDaily,
} from "./types";

type JsonObject = Record<string, unknown>;
type TokenKey =
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheCreationTokens"
  | "totalTokens";

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function asObjects(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.map(asObject).filter((item): item is JsonObject => Boolean(item));
}

function requiredToken(row: JsonObject, key: TokenKey, context: string) {
  const value = row[key];
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Invalid " + key + " for " + context + ".");
  }

  return parsed;
}

function optionalCost(row: JsonObject, context: string) {
  for (const key of ["totalCost", "costUSD", "cost"]) {
    if (row[key] !== undefined && row[key] !== null) {
      const parsed = Number(row[key]);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error("Invalid cost for " + context + ".");
      }
      return parsed;
    }
  }
  return null;
}

function normalizedAgent(value: unknown) {
  if (typeof value !== "string") return null;
  const agent = value.trim().toLowerCase();
  if (!agent || agent === "all") return null;
  return agent;
}

function normalizedDate(row: JsonObject) {
  const value =
    typeof row.period === "string"
      ? row.period
      : typeof row.date === "string"
        ? row.date
        : null;

  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const parsed = new Date(value + "T00:00:00Z");
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    return null;
  }

  return value;
}

function observationFrom(
  row: JsonObject,
  agent: string,
  usageDate: string,
): DailyUsageObservationInput {
  const context = agent + " on " + usageDate;
  const input_tokens = requiredToken(row, "inputTokens", context);
  const output_tokens = requiredToken(row, "outputTokens", context);
  const cache_read_tokens = requiredToken(row, "cacheReadTokens", context);
  const cache_creation_tokens = requiredToken(
    row,
    "cacheCreationTokens",
    context,
  );
  const reported_total_tokens = requiredToken(row, "totalTokens", context);
  const reported_cost_usd = optionalCost(row, context);

  const accounting_delta_tokens =
    reported_total_tokens -
    (input_tokens +
      output_tokens +
      cache_read_tokens +
      cache_creation_tokens);

  const withoutHash = {
    agent,
    usage_date: usageDate,
    input_tokens,
    output_tokens,
    cache_read_tokens,
    cache_creation_tokens,
    reported_total_tokens,
    accounting_delta_tokens,
    reported_cost_usd,
    is_tombstone: false,
  };

  return {
    ...withoutHash,
    usage_hash: usageHash(withoutHash),
  };
}

function topLevelDaily(payload: JsonObject) {
  if (Array.isArray(payload.daily)) {
    return {
      rows: asObjects(payload.daily),
      shape: "unified-daily" as const,
    };
  }

  if (payload.type === "daily" && Array.isArray(payload.data)) {
    return {
      rows: asObjects(payload.data),
      shape: "standard-daily" as const,
    };
  }

  throw new Error(
    "Unsupported ccusage JSON. Expected a daily report generated with --by-agent --json.",
  );
}

export function parseCcusageDaily(payload: unknown): ParsedCcusageDaily {
  const root = asObject(payload);
  if (!root) throw new Error("The uploaded file is not a JSON object.");

  const { rows: days, shape } = topLevelDaily(root);
  if (days.length === 0) throw new Error("The ccusage daily report is empty.");

  const observations = new Map<string, DailyUsageObservationInput>();
  const warnings: string[] = [];
  const dates: string[] = [];

  for (const day of days) {
    const usageDate = normalizedDate(day);
    if (!usageDate) {
      throw new Error("A daily row is missing a valid YYYY-MM-DD date.");
    }

    dates.push(usageDate);
    const agentRows = asObjects(day.agents);

    if (agentRows.length === 0) {
      const agent = normalizedAgent(day.agent);
      if (!agent) {
        throw new Error(
          "This export has no per-agent breakdown. Generate it with: ccusage daily --by-agent --json.",
        );
      }
      agentRows.push(day);
    }

    const agentSums = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
    };

    for (const agentRow of agentRows) {
      const agent = normalizedAgent(agentRow.agent);
      if (!agent) {
        throw new Error(
          "A per-agent row is missing a valid agent on " + usageDate + ".",
        );
      }

      const observation = observationFrom(agentRow, agent, usageDate);
      const key = agent + "|" + usageDate;
      const previous = observations.get(key);

      if (previous && previous.usage_hash !== observation.usage_hash) {
        throw new Error(
          "Conflicting rows for " + agent + " on " + usageDate + " in one file.",
        );
      }

      observations.set(key, observation);
      agentSums.inputTokens += observation.input_tokens;
      agentSums.outputTokens += observation.output_tokens;
      agentSums.cacheReadTokens += observation.cache_read_tokens;
      agentSums.cacheCreationTokens += observation.cache_creation_tokens;
      agentSums.totalTokens += observation.reported_total_tokens;
    }

    for (const key of [
      "inputTokens",
      "outputTokens",
      "cacheReadTokens",
      "cacheCreationTokens",
      "totalTokens",
    ] as const) {
      const dayValue = requiredToken(day, key, "day " + usageDate);
      if (agentSums[key] !== dayValue) {
        throw new Error(
          "Per-agent " +
            key +
            " do not reconcile with the day value on " +
            usageDate +
            ": agents=" +
            agentSums[key] +
            ", day=" +
            dayValue +
            ".",
        );
      }
    }
  }

  const parsedRows = [...observations.values()].sort((a, b) => {
    const byDate = a.usage_date.localeCompare(b.usage_date);
    return byDate || a.agent.localeCompare(b.agent);
  });

  if (parsedRows.length === 0) {
    throw new Error("No agent usage rows were found in this export.");
  }

  dates.sort();
  const totals = parsedRows.reduce(
    (acc, row) => {
      acc.inputTokens += row.input_tokens;
      acc.outputTokens += row.output_tokens;
      acc.cacheReadTokens += row.cache_read_tokens;
      acc.cacheCreationTokens += row.cache_creation_tokens;
      acc.reportedTotalTokens += row.reported_total_tokens;
      return acc;
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reportedTotalTokens: 0,
    },
  );

  const reportedTotals = asObject(root.totals);
  if (reportedTotals) {
    const comparisons: Array<[TokenKey, number]> = [
      ["inputTokens", totals.inputTokens],
      ["outputTokens", totals.outputTokens],
      ["cacheReadTokens", totals.cacheReadTokens],
      ["cacheCreationTokens", totals.cacheCreationTokens],
      ["totalTokens", totals.reportedTotalTokens],
    ];

    for (const [key, calculated] of comparisons) {
      const reported = requiredToken(reportedTotals, key, "top-level totals");
      if (reported !== calculated) {
        throw new Error(
          "Daily rows do not reconcile with top-level " +
            key +
            ": rows=" +
            calculated +
            ", totals=" +
            reported +
            ".",
        );
      }
    }
  }

  return {
    rows: parsedRows,
    scopeStart: dates[0],
    scopeEnd: dates[dates.length - 1],
    agents: [...new Set(parsedRows.map((row) => row.agent))].sort(),
    sourceShape: shape,
    warnings,
    totals,
  };
}
