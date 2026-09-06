/** V2 presentation helpers. No domain decisions live here. */

export function formatPercent(fraction: number, digits: number = 2): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/**
 * Whole-percent formatting for RAW provider readings. The OpenCode API
 * reports whole percents, so provider values must not imply decimals the
 * source never supplied. Contract ceilings and derived headroom keep
 * `formatPercent` decimals.
 */
export function formatWholePercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

export function formatPoints(fraction: number, digits: number = 2): string {
  const sign = fraction > 0 ? "+" : fraction < 0 ? "\u2212" : "";
  return `${sign}${Math.abs(fraction * 100).toFixed(digits)} pp`;
}

export function formatCasablancaShort(instantIso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Casablanca",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(instantIso));
}

export function formatCasablancaDate(instantIso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Casablanca",
    month: "short",
    day: "2-digit",
  }).format(new Date(instantIso));
}

export function countdownTo(msUntil: number | null): string {
  if (msUntil == null) return "Cycle ends at reset";
  if (msUntil === 0) return "now";
  const past = msUntil < 0;
  const abs = Math.abs(msUntil);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const minutes = Math.floor((abs % 3600000) / 60000);
  let core: string;
  if (days > 0) core = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  else if (hours > 0) core = minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  else core = `${minutes}m`;
  return past ? `${core} ago` : `in ${core}`;
}

/**
 * Format an ISO instant as "Aug 30" in Casablanca time. Unlike slicing the
 * ISO date prefix (which is UTC), this respects the workbook wall-clock day.
 * Presentation only.
 */
export function formatCasablancaMonthDay(instantIso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Casablanca",
    month: "short",
    day: "numeric",
  }).formatToParts(new Date(instantIso));
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${month} ${day}`;
}

/**
 * Describe a checkpoint timestamp relative to now in Casablanca time:
 * "Today" when it falls on the current calendar day, otherwise "Sep 6".
 * Part types (not split display text) keep this ICU-data independent.
 * Presentation only.
 */
export function describeCheckpointDay(timestampMs: number, nowMs: number): string {
  const dayKey = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Casablanca",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  };
  if (dayKey(timestampMs) === dayKey(nowMs)) return "Today";
  const [year, month, day] = dayKey(timestampMs).split("-");
  return formatCheckpointDate(`${year}-${month}-${day}`);
}

/**
 * Format a contract checkpoint date ("2026-09-05") as "Sep 5".
 * Presentation only; the input is a calendar date, not an instant.
 */
export function formatCheckpointDate(date: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const month = months[Number(match[2]) - 1] ?? match[2];
  return `${month} ${Number(match[3])}`;
}

export function formatFreshnessAge(ageMs: number | null): string {
  if (ageMs == null) return "never synced";
  if (ageMs < 0) return "just now";
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `synced ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin === 0 ? `synced ${hours}h ago` : `synced ${hours}h ${remMin}m ago`;
}
