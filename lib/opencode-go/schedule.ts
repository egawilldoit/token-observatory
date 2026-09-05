import {
  casablancaWallToInstant,
  formatCasablancaDate,
  instantToIso,
  localDateList,
} from "./time.js";

export type GeneratedCheckpoint = {
  day: number;
  date: string;
  checkTime: string;
  timestampMs: number;
  timestamp: string;
};

export function generateCheckpoints(args: {
  trackingStartMs: number;
  resetAtMs: number;
  checkTime: string;
}): GeneratedCheckpoint[] {
  const { trackingStartMs, resetAtMs, checkTime } = args;
  if (!/^\d{2}:\d{2}$/.test(checkTime)) {
    throw new Error(`Invalid check time: ${checkTime}`);
  }
  if (!(resetAtMs > trackingStartMs)) {
    throw new Error("resetAt must be after trackingStart");
  }
  const startDate = formatCasablancaDate(trackingStartMs);
  const endDate = formatCasablancaDate(resetAtMs);
  const dates = localDateList(startDate, endDate);
  const out: GeneratedCheckpoint[] = [];
  for (const date of dates) {
    const candidate = casablancaWallToInstant(date, checkTime);
    if (candidate > trackingStartMs && candidate < resetAtMs) {
      out.push({
        day: out.length + 1,
        date,
        checkTime,
        timestampMs: candidate,
        timestamp: instantToIso(candidate),
      });
    }
  }
  return out;
}
