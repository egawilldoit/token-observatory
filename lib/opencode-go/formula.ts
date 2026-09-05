import { checkpointCeiling, plannedCeiling } from "./calculations";
import type { OpenCodeGoFormulaWarning, OpenCodeGoParsedWorkbook } from "./types";

export const FORMULA_TOLERANCE = 1e-6;
export const MAX_FORMULA_WARNINGS = 50;

export type FormulaReconciliation = {
  formulaValuesAvailable: boolean;
  mismatchCount: number;
  warnings: OpenCodeGoFormulaWarning[];
  applicationPlannedCeiling: number;
  applicationCeilings: { day: number; ceiling: number }[];
};

export function reconcileFormulas(
  parsed: OpenCodeGoParsedWorkbook,
  tolerance: number = FORMULA_TOLERANCE,
): FormulaReconciliation {
  const applicationPlannedCeiling = plannedCeiling({
    hardLimit: parsed.hardLimit,
    safetyReserve: parsed.safetyReserve,
  });

  const applicationCeilings = parsed.checkpoints.map((c) => ({
    day: c.day,
    ceiling: checkpointCeiling({
      checkpointMs: c.timestampMs,
      trackingStartMs: parsed.trackingStartMs,
      resetAtMs: parsed.resetAtMs,
      baselineUsage: parsed.baselineUsage,
      plannedCeilingValue: applicationPlannedCeiling,
    }),
  }));
  const ceilingByDay = new Map(applicationCeilings.map((c) => [c.day, c.ceiling]));

  const warnings: OpenCodeGoFormulaWarning[] = [];
  const values = parsed.formulaValues ?? [];
  for (const f of values) {
    if (f.field === "plannedCeiling") {
      if (Math.abs(f.value - applicationPlannedCeiling) > tolerance && warnings.length < MAX_FORMULA_WARNINGS) {
        warnings.push({
          field: "plannedCeiling",
          workbookValue: f.value,
          applicationValue: applicationPlannedCeiling,
        });
      }
    } else if (f.field === "checkpointCeiling" && f.checkpointDay != null) {
      const app = ceilingByDay.get(f.checkpointDay);
      if (app != null && Math.abs(f.value - app) > tolerance && warnings.length < MAX_FORMULA_WARNINGS) {
        warnings.push({
          field: "checkpointCeiling",
          checkpointDay: f.checkpointDay,
          workbookValue: f.value,
          applicationValue: app,
        });
      }
    }
  }

  return {
    formulaValuesAvailable: values.length > 0,
    mismatchCount: warnings.length,
    warnings,
    applicationPlannedCeiling,
    applicationCeilings,
  };
}
