import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import * as XLSX from "xlsx";

import { buildOpenCodeGoWorkbookBuffer } from "../lib/opencode-go/fixtures.js";
import { parseOpenCodeGoWorkbook } from "../lib/opencode-go/parser.js";
import {
  OPENCODE_GO_EFFECTIVE_MAX_FILE_BYTES,
  OPENCODE_GO_EFFECTIVE_MAX_REQUEST_BYTES,
} from "../lib/opencode-go/xlsx-security.js";

describe("OpenCode Go review hardening", () => {
  it("keeps deployed upload limits below Vercel's 4.5 MB request cap", () => {
    assert.equal(OPENCODE_GO_EFFECTIVE_MAX_FILE_BYTES, 4 * 1024 * 1024);
    assert.equal(
      OPENCODE_GO_EFFECTIVE_MAX_REQUEST_BYTES,
      4 * 1024 * 1024 + 256 * 1024,
    );
    assert.ok(
      OPENCODE_GO_EFFECTIVE_MAX_FILE_BYTES < OPENCODE_GO_EFFECTIVE_MAX_REQUEST_BYTES,
    );
    assert.ok(
      OPENCODE_GO_EFFECTIVE_MAX_REQUEST_BYTES < 4_500_000,
      "multipart limit must remain below Vercel's upstream 4.5 MB payload cap",
    );
    assert.ok(
      OPENCODE_GO_EFFECTIVE_MAX_REQUEST_BYTES - OPENCODE_GO_EFFECTIVE_MAX_FILE_BYTES >=
        256 * 1024,
      "reserve multipart framing overhead above the advertised file limit",
    );
  });

  it("accepts required derived labels when cached values are unavailable", () => {
    const input = buildOpenCodeGoWorkbookBuffer();
    const wb = XLSX.read(input, { type: "buffer", cellDates: true });
    const ws = wb.Sheets["Monthly Tracker"];
    assert.ok(ws);

    // These labels are required by the V1 shape, but their values are derived
    // by the application. Excel is allowed to omit cached formula results.
    for (const address of ["B5", "B10", "B11", "B12"]) {
      delete ws[address];
    }

    const rewritten = Buffer.from(
      XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Uint8Array,
    );
    const parsed = parseOpenCodeGoWorkbook(rewritten);

    assert.equal(parsed.baselineUsage, 0.048);
    assert.equal(parsed.checkTime, "12:00");
    assert.equal(parsed.hardLimit, 1);
    assert.equal(parsed.safetyReserve, 0);
    assert.equal(parsed.plannedCeiling, null);
    assert.equal(parsed.checkpoints.length, 29);
  });

  it("keeps the private Storage bucket limit aligned with the deployed file limit", async () => {
    const migration = await readFile(
      new URL(
        "../supabase/migrations/20260905_010_opencode_go_upload_limit.sql",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(migration, /file_size_limit\s*=\s*4\s*\*\s*1024\s*\*\s*1024/i);
    assert.match(migration, /where\s+id\s*=\s*'opencode-go-imports'/i);
  });

  it("serializes same-cycle imports before reading accepted history", async () => {
    const migration = await readFile(
      new URL(
        "../supabase/migrations/20260905_011_opencode_go_cycle_processing_guard.sql",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(migration, /create\s+unique\s+index/i);
    assert.match(migration, /tracking_start\s*,\s*reset_at/i);
    assert.match(migration, /where\s+status\s*=\s*'processing'/i);

    const route = await readFile(
      new URL("../app/api/opencode-go/import/route.ts", import.meta.url),
      "utf8",
    );
    const claim = route.indexOf('status: "processing"');
    const historyRead = route.indexOf('.eq("status", "processed")', claim);
    assert.ok(claim >= 0, "route must claim a processing row");
    assert.ok(historyRead > claim, "same-cycle history must be read only after the processing claim");
    assert.match(route, /Another workbook for this cycle is already processing/);
  });
});
