import * as XLSX from "xlsx";

import { validatePlanInputs } from "./calculations";
import {
  OPENCODE_GO_WORKBOOK_SHEET,
  OPENCODE_GO_WORKBOOK_TITLE,
} from "./config";
import { generateCheckpoints } from "./schedule";
import {
  casablancaWallToInstant,
  formatCasablancaDate,
  parseCasablancaDateTime,
} from "./time";
import type { OpenCodeGoParsedWorkbook } from "./types";

export type ParseCode =
  | "missing_sheet"
  | "title"
  | "missing_label"
  | "missing_headers"
  | "invalid_datetime"
  | "invalid_plan"
  | "invalid_actual"
  | "duplicate"
  | "non_increasing"
  | "schedule"
  | "monotonic";

export class OpenCodeGoParseError extends Error {
  code: ParseCode;
  constructor(code: ParseCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "OpenCodeGoParseError";
    this.code = code;
  }
}

const REQUIRED_LABELS = [
  "Current monthly usage",
  "Tracking starts",
  "Days until reset",
  "Daily check time",
  "Reset date/time",
  "Hard monthly limit",
  "Safety reserve",
  "Planned ceiling at reset",
  "Remaining usage budget",
  "Avg additional usage/day",
  "Daily checkpoint",
] as const;

const REQUIRED_HEADERS = [
  "Day #",
  "Date",
  "Check Time",
  "Max Monthly Usage",
  "Actual Usage",
  "Status",
  "Headroom",
] as const;

function fail(code: ParseCode, message: string): never {
  throw new OpenCodeGoParseError(code, message);
}

function cellString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    return t === "" ? null : t;
  }
  return null;
}

function parseFraction(raw: unknown, field: string): number {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) fail("invalid_plan", `${field} must be finite`);
    return raw;
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") fail("invalid_plan", `${field} is missing`);
    if (t.endsWith("%")) {
      const n = Number(t.slice(0, -1).trim());
      if (!Number.isFinite(n)) fail("invalid_plan", `${field} percentage is malformed`);
      return n / 100;
    }
    const n = Number(t);
    if (!Number.isFinite(n)) fail("invalid_plan", `${field} is malformed`);
    return n;
  }
  return fail("invalid_plan", `${field} is malformed`);
}

function dateCellToMs(raw: unknown, field: string, fallbackCheckTime: string): number {
  if (raw instanceof Date) {
    const ms = raw.getTime();
    if (!Number.isFinite(ms)) fail("invalid_datetime", `${field} is an invalid date`);
    if (ms < Date.UTC(2020, 0, 1) || ms > Date.UTC(2035, 0, 1)) {
      fail("invalid_datetime", `${field} date is out of range`);
    }
    return ms;
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) fail("invalid_datetime", `${field} is an invalid date`);
    const ms = Math.round((raw - 25569) * 86400000);
    if (ms < Date.UTC(2020, 0, 1) || ms > Date.UTC(2035, 0, 1)) {
      fail("invalid_datetime", `${field} date is out of range`);
    }
    return ms;
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") fail("invalid_datetime", `${field} is missing`);
    try {
      if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(t)) return parseCasablancaDateTime(t);
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return casablancaWallToInstant(t, fallbackCheckTime);
    } catch {
      // fall through
    }
    return fail("invalid_datetime", `${field} is an invalid date`);
  }
  return fail("invalid_datetime", `${field} is missing`);
}

function normalizeCheckTime(raw: unknown): string {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw < 1) {
    const minutes = Math.round(raw * 1440) % 1440;
    return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
  }
  if (raw instanceof Date) {
    const ms = raw.getTime();
    const minutes = Math.floor(ms / 60000) % 1440;
    const norm = ((minutes % 1440) + 1440) % 1440;
    return String(Math.floor(norm / 60)).padStart(2, "0") + ":" + String(norm % 60).padStart(2, "0");
  }
  if (typeof raw === "string") {
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw.trim());
    if (!m) fail("invalid_datetime", `daily check time is malformed: ${raw}`);
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh > 23 || mm > 59) fail("invalid_datetime", "daily check time is out of range");
    return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  }
  return fail("invalid_datetime", "daily check time is missing");
}

export function parseActualCell(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) fail("invalid_actual", "Actual Usage must be finite");
    if (raw < 0) fail("invalid_actual", "Actual Usage must be non-negative");
    return raw;
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t === "") return null;
    if (t.endsWith("%")) {
      const n = Number(t.slice(0, -1).trim());
      if (!Number.isFinite(n)) fail("invalid_actual", "Actual Usage percentage is malformed");
      if (n < 0) fail("invalid_actual", "Actual Usage must be non-negative");
      return n / 100;
    }
    const n = Number(t);
    if (!Number.isFinite(n)) fail("invalid_actual", "Actual Usage is malformed");
    if (n < 0) fail("invalid_actual", "Actual Usage must be non-negative");
    return n;
  }
  if (raw instanceof Date) fail("invalid_actual", "Actual Usage must be numeric");
  return fail("invalid_actual", "Actual Usage is malformed");
}

type Grid = unknown[][];

function findCell(grid: Grid, predicate: (v: string) => boolean): { r: number; c: number } | null {
  for (let r = 0; r < grid.length; r += 1) {
    const row = grid[r] as unknown[];
    for (let c = 0; c < row.length; c += 1) {
      const s = cellString(row[c]);
      if (s != null && predicate(s)) return { r, c };
    }
  }
  return null;
}

export function parseOpenCodeGoWorkbook(buffer: Buffer): OpenCodeGoParsedWorkbook {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", cellDates: true, sheetStubs: false });
  } catch {
    throw new OpenCodeGoParseError("missing_sheet", "malformed workbook: could not read sheets");
  }

  const sheetName = (wb.SheetNames ?? []).find((n) => n.trim() === OPENCODE_GO_WORKBOOK_SHEET);
  if (!sheetName) {
    fail("missing_sheet", `required sheet "${OPENCODE_GO_WORKBOOK_SHEET}" not found`);
  }
  const ws = wb.Sheets[sheetName as string] as XLSX.WorkSheet;
  if (!ws) fail("missing_sheet", `required sheet "${OPENCODE_GO_WORKBOOK_SHEET}" not found`);

  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  }) as Grid;

  const titleCell = findCell(grid, (v) => v === OPENCODE_GO_WORKBOOK_TITLE);
  if (!titleCell) {
    fail("title", `required title "${OPENCODE_GO_WORKBOOK_TITLE}" not found`);
  }

  const labelValue = new Map<string, unknown>();
  for (const label of REQUIRED_LABELS) {
    const found = findCell(grid, (v) => v === label);
    if (!found) fail("missing_label", `required label "${label}" not found`);
    const row = grid[found.r] as unknown[];
    let value: unknown = null;
    for (let c = found.c + 1; c < row.length; c += 1) {
      const s = cellString(row[c]);
      if (row[c] !== null || s !== null) {
        value = row[c];
        break;
      }
    }
    if (label !== "Daily checkpoint" && (value == null || cellString(value) === null) && typeof value !== "number" && !(value instanceof Date)) {
      if (value == null) fail("missing_label", `value for label "${label}" is missing`);
    }
    labelValue.set(label, value);
  }

  const baselineUsage = parseFraction(labelValue.get("Current monthly usage"), "baseline");
  const checkTime = normalizeCheckTime(labelValue.get("Daily check time"));
  const trackingStartMs = dateCellToMs(labelValue.get("Tracking starts"), "tracking start", checkTime);
  const resetAtMs = dateCellToMs(labelValue.get("Reset date/time"), "reset", checkTime);
  const hardLimit = parseFraction(labelValue.get("Hard monthly limit"), "hard limit");
  const safetyReserve = parseFraction(labelValue.get("Safety reserve"), "safety reserve");
  const plannedCeilingRaw = labelValue.get("Planned ceiling at reset");
  const plannedCeiling = typeof plannedCeilingRaw === "number" && Number.isFinite(plannedCeilingRaw)
    ? (plannedCeilingRaw as number)
    : null;

  if (!(resetAtMs > trackingStartMs)) {
    fail("invalid_datetime", "tracking start must be before reset");
  }
  try {
    validatePlanInputs({ baselineUsage, hardLimit, safetyReserve });
  } catch (error) {
    throw new OpenCodeGoParseError("invalid_plan", error instanceof Error ? error.message : "invalid plan");
  }

  const headerRowIndex = grid.findIndex((row) =>
    REQUIRED_HEADERS.every((h) => (row as unknown[]).some((cell) => cellString(cell) === h)),
  );
  if (headerRowIndex < 0) {
    fail("missing_headers", "required checkpoint headers not found");
  }
  const headerRow = grid[headerRowIndex] as unknown[];
  const colIndex = new Map<string, number>();
  for (const h of REQUIRED_HEADERS) {
    colIndex.set(h, headerRow.findIndex((cell) => cellString(cell) === h));
  }

  const rawRows: {
    day: unknown;
    date: unknown;
    check: unknown;
    ceiling: unknown;
    actual: unknown;
  }[] = [];
  for (let r = headerRowIndex + 1; r < grid.length; r += 1) {
    const row = grid[r] as unknown[];
    const dayRaw = row[colIndex.get("Day #") as number];
    if (dayRaw == null || (typeof dayRaw === "string" && dayRaw.trim() === "")) break;
    rawRows.push({
      day: dayRaw,
      date: row[colIndex.get("Date") as number],
      check: row[colIndex.get("Check Time") as number],
      ceiling: row[colIndex.get("Max Monthly Usage") as number],
      actual: row[colIndex.get("Actual Usage") as number],
    });
  }
  if (rawRows.length === 0) {
    fail("schedule", "checkpoint table has no rows");
  }

  const checkpoints = rawRows.map((row, i) => {
    const day = typeof row.day === "number" ? row.day : Number(String(row.day).trim());
    if (!Number.isInteger(day)) fail("schedule", `Day # row ${i + 1} is not an integer`);
    const timestampMs = dateCellToMs(row.date, `checkpoint row ${i + 1} date`, checkTime);
    const date = formatCasablancaDate(timestampMs);
    const rowCheckTime = row.check == null || (typeof row.check === "string" && row.check.trim() === "")
      ? checkTime
      : normalizeCheckTime(row.check);
    const ceiling = row.ceiling == null || (typeof row.ceiling === "string" && row.ceiling.trim() === "")
      ? null
      : parseFraction(row.ceiling, `checkpoint row ${i + 1} ceiling`);
    const actual = parseActualCell(row.actual);
    return { day, date, checkTime: rowCheckTime, timestampMs, ceiling, actual };
  });

  checkpoints.forEach((c, i) => {
    if (c.day !== i + 1) fail("schedule", `Day # values must be contiguous 1..N (row ${i + 1} has ${c.day})`);
  });

  const seen = new Set<number>();
  for (const c of checkpoints) {
    if (seen.has(c.timestampMs)) fail("duplicate", `duplicate checkpoint timestamp: ${c.date}`);
    seen.add(c.timestampMs);
  }
  for (let i = 1; i < checkpoints.length; i += 1) {
    if (!((checkpoints[i] as (typeof checkpoints)[number]).timestampMs > (checkpoints[i - 1] as (typeof checkpoints)[number]).timestampMs)) {
      fail("non_increasing", "checkpoint timestamps must be strictly increasing");
    }
  }
  for (const c of checkpoints) {
    if (c.checkTime !== checkTime) {
      fail("schedule", `inconsistent checkpoint time ${c.checkTime} on ${c.date} (expected ${checkTime})`);
    }
  }

  const expected = generateCheckpoints({ trackingStartMs, resetAtMs, checkTime });
  if (expected.length !== checkpoints.length) {
    fail("schedule", `expected ${expected.length} checkpoints, found ${checkpoints.length}`);
  }
  for (let i = 0; i < expected.length; i += 1) {
    const e = expected[i] as { date: string; timestampMs: number };
    const c = checkpoints[i] as (typeof checkpoints)[number];
    if (e.date !== c.date || e.timestampMs !== c.timestampMs) {
      fail("schedule", `checkpoint ${i + 1} mismatch: workbook ${c.date} vs expected ${e.date}`);
    }
  }

  let lastActual: number | null = null;
  for (const c of checkpoints) {
    if (c.actual != null) {
      if (lastActual != null && (c.actual as number) < lastActual) {
        fail("monotonic", `Actual Usage decreases at ${c.date}: ${(c.actual as number)} < ${lastActual}`);
      }
      lastActual = c.actual as number;
    }
  }

  const formulaValues: OpenCodeGoParsedWorkbook["formulaValues"] = [];
  if (typeof plannedCeilingRaw === "number" && Number.isFinite(plannedCeilingRaw)) {
    formulaValues.push({ field: "plannedCeiling", value: plannedCeilingRaw });
  }
  for (const c of checkpoints) {
    if (c.ceiling != null) {
      formulaValues.push({ field: "checkpointCeiling", checkpointDay: c.day, value: c.ceiling as number });
    }
  }

  return {
    baselineUsage,
    trackingStartMs,
    resetAtMs,
    checkTime,
    hardLimit,
    safetyReserve,
    plannedCeiling,
    checkpoints,
    formulaValues,
  };
}
