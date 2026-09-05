import { inflateRawSync } from "node:zlib";

/**
 * OpenCode Go XLSX security preflight.
 *
 * Treats `.xlsx` as an untrusted ZIP container and validates it BEFORE any
 * workbook parsing. Dependency-free: parses the ZIP central directory
 * manually and uses node:zlib only to bound decompressed sizes.
 *
 * Target limits (spec §19):
 * - max XLSX file size:             8 MiB
 * - max multipart request size:    10 MiB (enforced in the route via Content-Length + File.size)
 * - max ZIP entries:               256
 * - max single uncompressed entry: 16 MiB
 * - max total uncompressed size:   32 MiB
 *
 * Deployment note: Vercel serverless request payloads cap around ~4.5 MB on
 * Hobby (higher on Pro). The application enforces the spec targets above, but
 * the EFFECTIVE production ceiling on Hobby is the lower Vercel platform cap:
 * files above ~4.5 MB are rejected upstream before application code runs.
 * Do not advertise 8 MiB as guaranteed on Hobby.
 */
export const OPENCODE_GO_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const OPENCODE_GO_MAX_REQUEST_BYTES = 10 * 1024 * 1024;
export const OPENCODE_GO_MAX_ZIP_ENTRIES = 256;
export const OPENCODE_GO_MAX_SINGLE_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
export const OPENCODE_GO_MAX_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

export type XlsxPreflightCode =
  | "too_large"
  | "not_zip"
  | "malformed"
  | "traversal"
  | "encrypted"
  | "macro"
  | "too_many_entries"
  | "entry_too_large"
  | "total_too_large"
  | "unsupported_structure";

export class XlsxPreflightError extends Error {
  code: XlsxPreflightCode;
  constructor(code: XlsxPreflightCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "XlsxPreflightError";
    this.code = code;
  }
}

type ZipEntry = {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

function findEocd(buffer: Buffer): number {
  const minStart = Math.max(0, buffer.length - (65557 + 22));
  for (let i = buffer.length - 22; i >= minStart; i -= 1) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x05 &&
      buffer[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

function parseCentralDirectory(buffer: Buffer): ZipEntry[] {
  const eocd = findEocd(buffer);
  if (eocd < 0) {
    throw new XlsxPreflightError("malformed", "ZIP end-of-central-directory not found");
  }
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (centralOffset > buffer.length) {
    throw new XlsxPreflightError("malformed", "ZIP central directory offset out of range");
  }
  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (cursor + 46 > buffer.length) {
      throw new XlsxPreflightError("malformed", "ZIP central directory truncated");
    }
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new XlsxPreflightError("malformed", "ZIP central directory signature mismatch");
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameLen > buffer.length) {
      throw new XlsxPreflightError("malformed", "ZIP entry name out of range");
    }
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localHeaderOffset });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function isUnsafePath(name: string): boolean {
  if (name.length === 0 || name.length > 1024) return true;
  if (name.includes("\\")) return true;
  if (name.startsWith("/") || name.startsWith("!")) return true;
  if (/^[A-Za-z]:/.test(name)) return true;
  const segments = name.split("/");
  if (segments.some((s) => s === ".." || s === "")) {
    if (name.endsWith("/") && segments[segments.length - 1] === "") {
      return segments.slice(0, -1).some((s) => s === ".." || s === "");
    }
    return true;
  }
  if (name.includes("\0")) return true;
  return false;
}

function isMacroEntry(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith("vbaproject.bin") ||
    lower.endsWith("vbadata.xml") ||
    lower.includes("xl/vba") ||
    lower.includes("xl/macros") ||
    lower.includes("xl/activex")
  );
}

function entryDataSlice(buffer: Buffer, entry: ZipEntry): Buffer {
  const off = entry.localHeaderOffset;
  if (off + 30 > buffer.length || buffer.readUInt32LE(off) !== 0x04034b50) {
    throw new XlsxPreflightError("malformed", `local header missing for ${entry.name}`);
  }
  const nameLen = buffer.readUInt16LE(off + 26);
  const extraLen = buffer.readUInt16LE(off + 28);
  const start = off + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (end > buffer.length) {
    throw new XlsxPreflightError("malformed", `entry data out of range for ${entry.name}`);
  }
  return buffer.subarray(start, end);
}

function decompressedLength(buffer: Buffer, entry: ZipEntry): number {
  // Stored entries must match their declared size exactly; archives using
  // data descriptors (zeroed header sizes) are rejected as malformed rather
  // than guessed. This keeps the size accounting below truthful.
  if (entry.method === 0) {
    return entryDataSlice(buffer, entry).length;
  }
  if (entry.method !== 8) {
    throw new XlsxPreflightError("unsupported_structure", `unsupported compression method ${entry.method}`);
  }
  const slice = entryDataSlice(buffer, entry);
  if (entry.compressedSize === 0 && entry.uncompressedSize > 0) {
    throw new XlsxPreflightError("malformed", `empty compressed data for ${entry.name}`);
  }
  let inflated: Buffer;
  try {
    inflated = inflateRawSync(slice, {
      maxOutputLength: OPENCODE_GO_MAX_SINGLE_UNCOMPRESSED_BYTES + 1,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE"
    ) {
      throw new XlsxPreflightError("entry_too_large", `decompressed entry too large: ${entry.name}`);
    }
    throw new XlsxPreflightError("malformed", `could not inflate ${entry.name}`);
  }
  return inflated.length;
}

export function preflightXlsxBuffer(buffer: Buffer, filename: string): { ok: true; entryCount: number } {
  if (!/\.(xlsx)$/i.test(filename.trim())) {
    throw new XlsxPreflightError("unsupported_structure", "expected an .xlsx filename");
  }
  if (buffer.length === 0 || buffer.length > OPENCODE_GO_MAX_FILE_BYTES) {
    throw new XlsxPreflightError("too_large", `file must be between 1 byte and ${OPENCODE_GO_MAX_FILE_BYTES} bytes`);
  }
  if (
    buffer.length < 4 ||
    buffer[0] !== 0x50 ||
    buffer[1] !== 0x4b ||
    buffer[2] !== 0x03 ||
    buffer[3] !== 0x04
  ) {
    throw new XlsxPreflightError("not_zip", "file is not a ZIP/OOXML container");
  }

  const entries = parseCentralDirectory(buffer);

  if (entries.length === 0 || entries.length > OPENCODE_GO_MAX_ZIP_ENTRIES) {
    throw new XlsxPreflightError(
      "too_many_entries",
      `ZIP entry count ${entries.length} exceeds ${OPENCODE_GO_MAX_ZIP_ENTRIES}`,
    );
  }

  for (const entry of entries) {
    if (isUnsafePath(entry.name)) {
      throw new XlsxPreflightError("traversal", `unsafe ZIP entry path: ${entry.name}`);
    }
    if ((entry.flags & 0x1) !== 0) {
      throw new XlsxPreflightError("encrypted", `encrypted ZIP entry: ${entry.name}`);
    }
    const lower = entry.name.toLowerCase();
    if (lower === "encryptioninfo" || lower === "encryptedpackage") {
      throw new XlsxPreflightError("encrypted", `encrypted workbook package: ${entry.name}`);
    }
    if (isMacroEntry(entry.name)) {
      throw new XlsxPreflightError("macro", `macro/VBA content rejected: ${entry.name}`);
    }
    if (
      entry.uncompressedSize > OPENCODE_GO_MAX_SINGLE_UNCOMPRESSED_BYTES ||
      entry.compressedSize > OPENCODE_GO_MAX_FILE_BYTES
    ) {
      throw new XlsxPreflightError("entry_too_large", `ZIP entry too large: ${entry.name}`);
    }
  }

  let total = 0;
  for (const entry of entries) {
    const actual = decompressedLength(buffer, entry);
    if (actual !== entry.uncompressedSize && entry.method === 0) {
      throw new XlsxPreflightError("malformed", `stored entry size mismatch: ${entry.name}`);
    }
    if (actual > OPENCODE_GO_MAX_SINGLE_UNCOMPRESSED_BYTES) {
      throw new XlsxPreflightError("entry_too_large", `decompressed entry too large: ${entry.name}`);
    }
    total += actual;
    if (total > OPENCODE_GO_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new XlsxPreflightError("total_too_large", "total decompressed size exceeds 32 MiB");
    }
  }

  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  if (!names.has("[content_types].xml".toLowerCase()) || ![...names].some((n) => n === "xl/workbook.xml")) {
    throw new XlsxPreflightError("unsupported_structure", "missing required OOXML package parts");
  }

  return { ok: true, entryCount: entries.length };
}
