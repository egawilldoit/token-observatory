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
  if (msUntil <= 0) return "due now";
  const days = Math.floor(msUntil / 86400000);
  const hours = Math.floor((msUntil % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h to go`;
  const minutes = Math.floor((msUntil % 3600000) / 60000);
  return `${hours}h ${minutes}m to go`;
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
