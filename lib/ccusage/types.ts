export type DailyUsageObservationInput = {
  agent: string;
  usage_date: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  reported_total_tokens: number;
  accounting_delta_tokens: number;
  reported_cost_usd: number | null;
  is_tombstone: boolean;
  usage_hash: string;
};

export type DailyModelUsageObservationInput = {
  agent: string;
  model: string;
  usage_date: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  reported_total_tokens: number;
  accounting_delta_tokens: number;
  reported_cost_usd: number | null;
  is_tombstone: boolean;
  usage_hash: string;
};

export type ParsedCcusageDaily = {
  rows: DailyUsageObservationInput[];
  modelRows: DailyModelUsageObservationInput[];
  scopeStart: string;
  scopeEnd: string;
  agents: string[];
  models: string[];
  sourceShape: "unified-daily" | "standard-daily";
  warnings: string[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    reportedTotalTokens: number;
  };
};

export type CurrentDailyUsageRow = DailyUsageObservationInput & {
  machine_id: string;
  import_id?: string;
};

export type CurrentDailyModelUsageRow = DailyModelUsageObservationInput & {
  machine_id: string;
  import_id?: string;
};

export type DiffSummary = {
  newRows: DailyUsageObservationInput[];
  revisedRows: DailyUsageObservationInput[];
  removedRows: DailyUsageObservationInput[];
  unchangedRows: DailyUsageObservationInput[];
  beforeTotal: number;
  afterTotal: number;
  netChange: number;
};

export type ModelDiffSummary = {
  newRows: DailyModelUsageObservationInput[];
  revisedRows: DailyModelUsageObservationInput[];
  removedRows: DailyModelUsageObservationInput[];
  unchangedRows: DailyModelUsageObservationInput[];
  beforeTotal: number;
  afterTotal: number;
  netChange: number;
};
