import {
  modelUsageHash,
  sessionHashes,
  usageHash,
} from "./hash";
import type {
  DailyModelUsageObservationInput,
  DailyUsageObservationInput,
  ParsedCcusageDaily,
  SessionUsageObservationInput,
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

function optionalToken(
  row: JsonObject,
  key: TokenKey,
  context: string,
): number | null {
  if (row[key] === undefined || row[key] === null) return null;
  return requiredToken(row, key, context);
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

function normalizedIdentity(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    !normalized ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function normalizedAgent(value: unknown) {
  const agent = normalizedIdentity(value, 128);
  return !agent || agent === "all" ? null : agent;
}

function normalizedModel(value: unknown) {
  return normalizedIdentity(value, 256);
}

function normalizedModels(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map(normalizedModel)
        .filter((item): item is string => Boolean(item)),
    ),
  ].sort();
}

function normalizedTimestamp(value: unknown, context: string) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error("Invalid activity timestamp for " + context + ".");
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid activity timestamp for " + context + ".");
  }

  return parsed.toISOString();
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

function modelRowsFrom(agentRow: JsonObject) {
  const direct = asObjects(agentRow.modelBreakdowns);
  if (direct.length > 0) return direct;

  const breakdown = asObject(agentRow.breakdown);
  if (!breakdown) return [];

  const rows: JsonObject[] = [];
  for (const [modelName, value] of Object.entries(breakdown)) {
    const object = asObject(value);
    if (object) rows.push({ ...object, modelName });
  }
  return rows;
}

function modelObservationFrom(
  row: JsonObject,
  agent: string,
  usageDate: string,
): DailyModelUsageObservationInput {
  const model = normalizedModel(row.modelName ?? row.model);
  if (!model) {
    throw new Error(
      "A model breakdown is missing a valid model name for " +
        agent +
        " on " +
        usageDate +
        ".",
    );
  }

  const context = agent + "/" + model + " on " + usageDate;
  const input_tokens = requiredToken(row, "inputTokens", context);
  const output_tokens = requiredToken(row, "outputTokens", context);
  const cache_read_tokens = requiredToken(row, "cacheReadTokens", context);
  const cache_creation_tokens = requiredToken(
    row,
    "cacheCreationTokens",
    context,
  );
  const componentTotal =
    input_tokens +
    output_tokens +
    cache_read_tokens +
    cache_creation_tokens;
  const reported_total_tokens =
    optionalToken(row, "totalTokens", context) ?? componentTotal;
  const reported_cost_usd = optionalCost(row, context);
  const accounting_delta_tokens = reported_total_tokens - componentTotal;

  const withoutHash = {
    agent,
    model,
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
    usage_hash: modelUsageHash(withoutHash),
  };
}

function sessionRowsFrom(root: JsonObject) {
  if (Array.isArray(root.session)) return asObjects(root.session);
  if (Array.isArray(root.sessions)) return asObjects(root.sessions);

  const sessionReport = asObject(root.sessionReport);
  if (sessionReport && Array.isArray(sessionReport.sessions)) {
    return asObjects(sessionReport.sessions);
  }

  return [];
}

function sessionObservationFrom(row: JsonObject): SessionUsageObservationInput {
  const agent = normalizedAgent(row.agent ?? asObject(row.metadata)?.agent);
  if (!agent) {
    throw new Error("A session row is missing a valid source agent.");
  }

  const sessionId = normalizedIdentity(
    row.sessionId ?? row.session ?? row.period,
    512,
  );
  if (!sessionId) {
    throw new Error("A session row is missing a valid session identifier.");
  }

  const metadata = asObject(row.metadata);
  const context = agent + " session " + sessionId;
  const first_activity = normalizedTimestamp(
    row.firstActivity ?? metadata?.firstActivity,
    context,
  );
  const last_activity = normalizedTimestamp(
    row.lastActivity ?? metadata?.lastActivity,
    context,
  );
  const projectPathValue = row.projectPath ?? metadata?.projectPath;
  const project_path =
    typeof projectPathValue === "string" &&
    projectPathValue.length <= 4096 &&
    !/[\u0000-\u001f\u007f]/.test(projectPathValue)
      ? projectPathValue
      : null;

  const input_tokens = requiredToken(row, "inputTokens", context);
  const output_tokens = requiredToken(row, "outputTokens", context);
  const cache_read_tokens = requiredToken(row, "cacheReadTokens", context);
  const cache_creation_tokens = requiredToken(
    row,
    "cacheCreationTokens",
    context,
  );
  const componentTotal =
    input_tokens +
    output_tokens +
    cache_read_tokens +
    cache_creation_tokens;
  const reported_total_tokens =
    optionalToken(row, "totalTokens", context) ?? componentTotal;
  const reported_cost_usd = optionalCost(row, context);
  const accounting_delta_tokens = reported_total_tokens - componentTotal;
  const models = normalizedModels(row.modelsUsed ?? row.models);

  const withoutHashes = {
    agent,
    session_id: sessionId,
    first_activity,
    last_activity,
    input_tokens,
    output_tokens,
    cache_read_tokens,
    cache_creation_tokens,
    reported_total_tokens,
    accounting_delta_tokens,
    reported_cost_usd,
    models,
  };

  return {
    ...withoutHashes,
    ...sessionHashes({ ...withoutHashes, project_path }),
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
  const modelObservations = new Map<
    string,
    DailyModelUsageObservationInput
  >();
  const sessionObservations = new Map<
    string,
    SessionUsageObservationInput
  >();
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

      const modelRows = modelRowsFrom(agentRow);
      if (modelRows.length === 0) {
        if (
          observation.input_tokens +
            observation.output_tokens +
            observation.cache_read_tokens +
            observation.cache_creation_tokens >
          0
        ) {
          warnings.push(
            "No model breakdown for " + agent + " on " + usageDate + ".",
          );
        }
        continue;
      }

      const modelSums = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      };

      for (const modelRow of modelRows) {
        const modelObservation = modelObservationFrom(
          modelRow,
          agent,
          usageDate,
        );
        const modelKey =
          agent + "|" + modelObservation.model + "|" + usageDate;
        const previousModel = modelObservations.get(modelKey);

        if (
          previousModel &&
          previousModel.usage_hash !== modelObservation.usage_hash
        ) {
          throw new Error(
            "Conflicting model rows for " +
              agent +
              "/" +
              modelObservation.model +
              " on " +
              usageDate +
              " in one file.",
          );
        }

        modelObservations.set(modelKey, modelObservation);
        modelSums.inputTokens += modelObservation.input_tokens;
        modelSums.outputTokens += modelObservation.output_tokens;
        modelSums.cacheReadTokens += modelObservation.cache_read_tokens;
        modelSums.cacheCreationTokens += modelObservation.cache_creation_tokens;
      }

      const componentComparisons: Array<
        [keyof typeof modelSums, number]
      > = [
        ["inputTokens", observation.input_tokens],
        ["outputTokens", observation.output_tokens],
        ["cacheReadTokens", observation.cache_read_tokens],
        ["cacheCreationTokens", observation.cache_creation_tokens],
      ];

      for (const [component, expected] of componentComparisons) {
        if (modelSums[component] !== expected) {
          throw new Error(
            "Per-model " +
              component +
              " do not reconcile with " +
              agent +
              " on " +
              usageDate +
              ": models=" +
              modelSums[component] +
              ", agent=" +
              expected +
              ".",
          );
        }
      }
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

  for (const sessionRow of sessionRowsFrom(root)) {
    const observation = sessionObservationFrom(sessionRow);
    const previous = sessionObservations.get(observation.local_key_hash);
    if (previous && previous.session_hash !== observation.session_hash) {
      throw new Error(
        "Conflicting session rows for " +
          observation.agent +
          "/" +
          observation.session_id +
          " in one file.",
      );
    }
    sessionObservations.set(observation.local_key_hash, observation);
  }

  const parsedRows = [...observations.values()].sort((a, b) => {
    const byDate = a.usage_date.localeCompare(b.usage_date);
    return byDate || a.agent.localeCompare(b.agent);
  });
  const parsedModelRows = [...modelObservations.values()].sort((a, b) => {
    const byDate = a.usage_date.localeCompare(b.usage_date);
    const byAgent = a.agent.localeCompare(b.agent);
    return byDate || byAgent || a.model.localeCompare(b.model);
  });
  const parsedSessionRows = [...sessionObservations.values()].sort((a, b) => {
    const byAgent = a.agent.localeCompare(b.agent);
    const byActivity = (a.last_activity ?? "").localeCompare(
      b.last_activity ?? "",
    );
    return byAgent || byActivity || a.session_id.localeCompare(b.session_id);
  });

  if (parsedRows.length === 0) {
    throw new Error("No agent usage rows were found in this export.");
  }

  if (parsedSessionRows.length === 0) {
    warnings.push(
      "No session section found. Cross-machine session dedupe evidence is unavailable for this import.",
    );
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
    modelRows: parsedModelRows,
    sessionRows: parsedSessionRows,
    scopeStart: dates[0],
    scopeEnd: dates[dates.length - 1],
    agents: [...new Set(parsedRows.map((row) => row.agent))].sort(),
    models: [...new Set(parsedModelRows.map((row) => row.model))].sort(),
    sourceShape: shape,
    warnings: [...new Set(warnings)],
    totals,
  };
}
