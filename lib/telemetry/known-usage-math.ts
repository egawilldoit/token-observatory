export type KnownUsageTotals = {
  canonicalTokens: number;
  additiveRecoveredTokens: number;
  knownTokens: number;
};

export type CanonicalUsageTotalRow = {
  reported_total_tokens: number | string;
  global_duplicate?: boolean | null;
};

export type RecoveryUsageTotalRow = {
  total_tokens: number | string;
  accounting_mode: string;
};

export function combineKnownUsageTotals(
  canonicalRows: CanonicalUsageTotalRow[],
  recoveryRows: RecoveryUsageTotalRow[],
): KnownUsageTotals {
  const canonicalTokens = canonicalRows
    .filter((row) => !row.global_duplicate)
    .reduce((total, row) => total + Number(row.reported_total_tokens), 0);
  const additiveRecoveredTokens = recoveryRows
    .filter((row) => row.accounting_mode === "additive_recovered")
    .reduce((total, row) => total + Number(row.total_tokens), 0);

  return {
    canonicalTokens,
    additiveRecoveredTokens,
    knownTokens: canonicalTokens + additiveRecoveredTokens,
  };
}
