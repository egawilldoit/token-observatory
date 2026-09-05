import { OPENCODE_GO_TIMEZONE } from "./types";

export const CASABLANCA_TIMEZONE = OPENCODE_GO_TIMEZONE;

const partFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CASABLANCA_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type CasablancaParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
};

export function casablancaParts(instantMs: number): CasablancaParts {
  const parts = partFormatter.formatToParts(new Date(instantMs));
  const values = new Map(parts.map((p) => [p.type, p.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  if (!year || !month || !day || hour == null || minute == null) {
    throw new Error("Could not resolve Africa/Casablanca wall time.");
  }
  return { year, month, day, hour, minute };
}

export function formatCasablancaDate(instantMs: number): string {
  const p = casablancaParts(instantMs);
  return `${p.year}-${p.month}-${p.day}`;
}

export function formatCasablancaDateTime(instantMs: number): string {
  const p = casablancaParts(instantMs);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function parseWallInput(date: string, time: string): {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
} {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) {
    throw new Error(`Invalid Casablanca wall time: ${date} ${time}`);
  }
  const y = Number(dateMatch[1]);
  const m = Number(dateMatch[2]);
  const d = Number(dateMatch[3]);
  const hh = Number(timeMatch[1]);
  const mm = Number(timeMatch[2]);
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) {
    throw new Error(`Invalid Casablanca wall time: ${date} ${time}`);
  }
  return { y, m, d, hh, mm };
}

export function casablancaWallToInstant(date: string, time: string): number {
  const { y, m, d, hh, mm } = parseWallInput(date, time);
  let guess = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  for (let i = 0; i < 4; i += 1) {
    const p = casablancaParts(guess);
    const actualMinutes =
      Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) / 60000;
    const wantMinutes = Date.UTC(y, m - 1, d, hh, mm) / 60000;
    const diffMinutes = wantMinutes - actualMinutes;
    if (diffMinutes === 0) return guess;
    guess += diffMinutes * 60000;
  }
  const check = casablancaParts(guess);
  const got = `${check.year}-${check.month}-${check.day} ${check.hour}:${check.minute}`;
  const want = `${date} ${time}`;
  if (got !== want) {
    throw new Error(`Could not resolve Casablanca wall time: ${want} (got ${got})`);
  }
  return guess;
}

export function parseCasablancaDateTime(input: string): number {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid Africa/Casablanca datetime: ${input}`);
  }
  return casablancaWallToInstant(match[1] as string, match[2] as string);
}

export function instantToIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function localDateList(startDate: string, endDate: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error("localDateList expects YYYY-MM-DD bounds");
  }
  if (endDate < startDate) return [];
  const out: string[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    out.push(cursor);
    const [y, m, d] = cursor.split("-").map(Number);
    const next = new Date(Date.UTC(y as number, (m as number) - 1, d as number) + 86400000);
    cursor = next.toISOString().slice(0, 10);
  }
  return out;
}
