import { deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";

import { checkpointCeiling } from "./calculations";
import {
  OPENCODE_GO_DEFAULT_CHECK_TIME,
  OPENCODE_GO_WORKBOOK_SHEET,
  OPENCODE_GO_WORKBOOK_TITLE,
} from "./config";
import { casablancaWallToInstant, localDateList } from "./time";

export const FIXTURE_TITLE = OPENCODE_GO_WORKBOOK_TITLE;
export const FIXTURE_SHEET = OPENCODE_GO_WORKBOOK_SHEET;

export const FIXTURE_BASELINE = 0.048;
export const FIXTURE_TRACKING_START = "2026-08-30 22:29";
export const FIXTURE_RESET = "2026-09-29 11:29";
export const FIXTURE_CHECK_TIME = OPENCODE_GO_DEFAULT_CHECK_TIME;
export const FIXTURE_HARD_LIMIT = 1.0;
export const FIXTURE_RESERVE = 0.0;

export type FixtureActuals = Record<string, number | null>;

export type FixtureOptions = {
  actuals?: FixtureActuals;
  ceilingSkew?: number;
  dropDates?: string[];
  duplicateDate?: string;
  baseline?: number;
  title?: string;
  omitSheet?: boolean;
};

function checkpointDates(): string[] {
  return localDateList("2026-08-31", "2026-09-28");
}

function ceilingFor(date: string): number {
  const t = casablancaWallToInstant(date, FIXTURE_CHECK_TIME);
  const s = casablancaWallToInstant("2026-08-30", "22:29");
  const r = casablancaWallToInstant("2026-09-29", "11:29");
  return checkpointCeiling({
    checkpointMs: t,
    trackingStartMs: s,
    resetAtMs: r,
    baselineUsage: FIXTURE_BASELINE,
    plannedCeilingValue: 1.0,
  });
}

function excelDateTime(local: string): Date {
  const [d, t] = local.split(" ") as [string, string];
  const ms = casablancaWallToInstant(d as string, t as string);
  return new Date(ms);
}

export function buildOpenCodeGoWorkbookBuffer(options: FixtureOptions = {}): Buffer {
  const {
    actuals = {},
    ceilingSkew = 0,
    dropDates = [],
    duplicateDate = null,
    baseline = FIXTURE_BASELINE,
    title = FIXTURE_TITLE,
  } = options;

  const rows: unknown[][] = [];
  rows.push([title]);
  rows.push([]);
  rows.push(["Current monthly usage", baseline]);
  rows.push(["Tracking starts", excelDateTime(FIXTURE_TRACKING_START)]);
  rows.push(["Days until reset", 29]);
  rows.push(["Daily check time", FIXTURE_CHECK_TIME]);
  rows.push(["Reset date/time", excelDateTime(FIXTURE_RESET)]);
  rows.push(["Hard monthly limit", FIXTURE_HARD_LIMIT]);
  rows.push(["Safety reserve", FIXTURE_RESERVE]);
  rows.push(["Planned ceiling at reset", FIXTURE_HARD_LIMIT - FIXTURE_RESERVE]);
  rows.push(["Remaining usage budget", FIXTURE_HARD_LIMIT - FIXTURE_RESERVE - baseline]);
  rows.push(["Avg additional usage/day", (FIXTURE_HARD_LIMIT - FIXTURE_RESERVE - baseline) / 29]);
  rows.push([]);
  rows.push(["Daily checkpoint"]);
  rows.push(["Day #", "Date", "Check Time", "Max Monthly Usage", "Actual Usage", "Status", "Headroom"]);

  let dates = checkpointDates().filter((d) => !dropDates.includes(d));
  if (duplicateDate) {
    const idx = dates.indexOf(duplicateDate);
    if (idx >= 0) dates = [...dates.slice(0, idx + 1), duplicateDate, ...dates.slice(idx + 1)];
  }

  let day = 0;
  for (const date of dates) {
    day += 1;
    const ceiling = ceilingFor(date) + ceilingSkew;
    const hasActual = Object.prototype.hasOwnProperty.call(actuals, date);
    const actual = hasActual ? (actuals[date] as number | null) : null;
    rows.push([
      day,
      excelDateTime(`${date} ${FIXTURE_CHECK_TIME}`),
      FIXTURE_CHECK_TIME,
      ceiling,
      actual,
      "",
      "",
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  wb.Props = {
    Title: FIXTURE_TITLE,
    CreatedDate: new Date(Date.UTC(2026, 8, 5, 12, 0, 0)),
    ModifiedDate: new Date(Date.UTC(2026, 8, 5, 12, 0, 0)),
  };
  XLSX.utils.book_append_sheet(wb, ws, options.omitSheet ? "Wrong Sheet" : FIXTURE_SHEET);
  if (options.title === "__BLANK__") {
    ws["A1"] = { t: "s", v: "" };
  } else if (title !== FIXTURE_TITLE) {
    ws["A1"] = { t: "s", v: title };
  }
  const out = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
  return Buffer.from(out as Uint8Array);
}

function crc32(data: Uint8Array): number {
  let table = (crc32 as unknown as { table?: Uint32Array }).table;
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    (crc32 as unknown as { table?: Uint32Array }).table = table;
  }
  let crc = 0xffffffff;
  for (const b of data) crc = (table[(crc ^ b) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export type MinimalZipEntry = {
  name: string;
  data: Uint8Array | string;
  /** ZIP compression method: 0 = stored (default), 8 = deflated. */
  method?: 0 | 8;
};

export function buildMinimalZip(entries: MinimalZipEntry[]): Buffer {
  const enc = new TextEncoder();
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const rawBytes = typeof e.data === "string" ? enc.encode(e.data) : e.data;
    const method = e.method ?? 0;
    const storedBytes = method === 8 ? deflateRawSync(rawBytes) : Buffer.from(rawBytes);
    const crc = crc32(rawBytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0x5a5a, 10);
    local.writeUInt16LE(0x4a4a, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(storedBytes.length, 18);
    local.writeUInt32LE(rawBytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, Buffer.from(nameBytes), Buffer.from(storedBytes));
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0x5a5a, 12);
    cen.writeUInt16LE(0x4a4a, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(storedBytes.length, 20);
    cen.writeUInt32LE(rawBytes.length, 24);
    cen.writeUInt16LE(nameBytes.length, 28);
    for (let i = 30; i < 46; i += 1) cen.writeUInt8(0, i);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, Buffer.from(nameBytes));
    offset += 30 + nameBytes.length + storedBytes.length;
  }
  const centralStart = offset;
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, ...central, end]);
}

export const MINIMAL_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;
export const MINIMAL_WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Monthly Tracker" sheetId="1" r:id="rId1"/></sheets></workbook>`;

export function buildTraversalZip(): Buffer {
  return buildMinimalZip([
    { name: "[Content_Types].xml", data: MINIMAL_CONTENT_TYPES },
    { name: "xl/workbook.xml", data: MINIMAL_WORKBOOK },
    { name: "../evil.txt", data: "traversal" },
  ]);
}

export function buildVbaZip(): Buffer {
  return buildMinimalZip([
    { name: "[Content_Types].xml", data: MINIMAL_CONTENT_TYPES },
    { name: "xl/workbook.xml", data: MINIMAL_WORKBOOK },
    { name: "xl/vbaProject.bin", data: new Uint8Array([0xcc, 0x61, 0x00, 0x00]) },
  ]);
}

export function buildEncryptedSignalZip(): Buffer {
  return buildMinimalZip([
    { name: "[Content_Types].xml", data: MINIMAL_CONTENT_TYPES },
    { name: "EncryptionInfo", data: "encrypted" },
    { name: "EncryptedPackage", data: "encrypted" },
  ]);
}

export function buildOversizedEntryZip(entryCount: number): Buffer {
  const entries = [];
  for (let i = 0; i < entryCount; i += 1) {
    entries.push({ name: `xl/part${i}.xml`, data: "<x/>" });
  }
  return buildMinimalZip(entries);
}
