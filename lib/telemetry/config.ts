export const SUPPORTED_CCUSAGE_VERSION = "20.0.20";
export const TELEMETRY_TIMEZONE = "Africa/Casablanca";
export const LOOKBACK_DAYS = 3;
export const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
export const MAX_IMPORT_REQUEST_BYTES = MAX_IMPORT_BYTES + 512 * 1024;
export const MAX_COMMAND_USED_CHARS = 2048;
export const STALE_IMPORT_MINUTES = 15;
export const RAW_IMPORT_BUCKET =
  process.env.CCUSAGE_IMPORT_BUCKET ?? "raw-imports";

export function compactDate(date: string) {
  return date.replaceAll("-", "");
}

export function nextSinceFromDate(lastDate: string | null) {
  if (!lastDate) return null;

  const value = new Date(lastDate + "T12:00:00Z");
  if (Number.isNaN(value.getTime())) return null;

  value.setUTCDate(value.getUTCDate() - (LOOKBACK_DAYS - 1));
  return value.toISOString().slice(0, 10);
}

export function todayInTelemetryTimezone(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TELEMETRY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const values = new Map(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");

  if (!year || !month || !day) {
    throw new Error("Could not resolve the telemetry calendar date.");
  }

  return year + "-" + month + "-" + day;
}

export function isFutureTelemetryDate(date: string, now = new Date()) {
  return date > todayInTelemetryTimezone(now);
}

export function buildCcusageCommand(since?: string | null) {
  const parts = [
    "npx",
    "ccusage@" + SUPPORTED_CCUSAGE_VERSION,
    "daily",
    "--sections",
    "daily,session",
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
