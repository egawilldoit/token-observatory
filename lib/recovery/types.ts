export type RecoveredUsageSet = {
  id: string;
  description: string;
  source_type: string;
  source_machine_count: number;
  suspected_mirror: boolean;
  accounting_mode: string;
  confidence: string;
  granularity: string;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  total_tokens: number;
  reported_cost_usd: number | null;
  pricing_complete: boolean;
  warnings: string[];
  raw_terminal_text: string;
  created_at: string;
};

export type RecoveredUsageSetSummary = Omit<
  RecoveredUsageSet,
  "raw_terminal_text"
>;

export type RecoveredMonthlyUsage = {
  id: string;
  recovery_set_id: string;
  month: string;
  agent: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_tokens: number;
  reported_cost_usd: number | null;
  models: string[];
  created_at: string;
};

export type RecoveredUsageEvidence = {
  set: RecoveredUsageSetSummary;
  rows: RecoveredMonthlyUsage[];
};
