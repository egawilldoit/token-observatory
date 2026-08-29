export const SUPPORTED_CCUSAGE_VERSION = "20.0.20";
export const TELEMETRY_TIMEZONE = "Africa/Casablanca";
export const LOOKBACK_DAYS = 3;
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const RAW_IMPORT_BUCKET =
  process.env.CCUSAGE_IMPORT_BUCKET ?? "raw-imports";

export function compactDate(date: string) {
  return date.replaceAll("-", "");
}

export function nextSinceFromDate(lastDate: string | null) {
  if (!lastDate) return null;

  const value = new Date(lastDate + "T12:00:00Z");
  if (Number.isNaN(value.getTime())) return null;

  // LOOKBACK_DAYS=3 means include the latest accepted date plus two days
  // before it: e.g. Aug 28 -> Aug 26.
  value.setUTCDate(value.getUTCDate() - (LOOKBACK_DAYS - 1));
  return value.toISOString().slice(0, 10);
}

export function buildCcusageCommand(since?: string | null) {
  const parts = [
    "npx",
    "ccusage@" + SUPPORTED_CCUSAGE_VERSION,
    "daily",
    "--by-agent",
    "--breakdown",
    "--timezone",
    TELEMETRY_TIMEZONE,
  ];

  if (since) {
    parts.push("--since", compactDate(since));
  }

  parts.push("--json", ">", "ccusage.json");
  return parts.join(" ");
}
