import { createHash, randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getObservatoryAccess } from "@/lib/auth/require-user";
import {
  budgetRemaining,
  checkpointCeiling,
  latestRecordedActual,
  plannedCeiling,
} from "@/lib/opencode-go/calculations";
import { OPENCODE_GO_BUCKET } from "@/lib/opencode-go/config";
import { reconcileFormulas } from "@/lib/opencode-go/formula";
import {
  OpenCodeGoConflictError,
  validateCorrection,
  validateSameCyclePlan,
} from "@/lib/opencode-go/import-semantics";
import { OpenCodeGoParseError, parseOpenCodeGoWorkbook } from "@/lib/opencode-go/parser";
import {
  OPENCODE_GO_MAX_FILE_BYTES,
  OPENCODE_GO_MAX_REQUEST_BYTES,
  XlsxPreflightError,
  preflightXlsxBuffer,
} from "@/lib/opencode-go/xlsx-security";
import { isCrossOriginRequest, requestExceedsBytes } from "@/lib/http/request";
import { createAdminClient, isTelemetryConfigured } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function safeFilename(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
  const withExt = /\.xlsx$/i.test(cleaned) ? cleaned : `${cleaned || "tracker"}.xlsx`;
  return withExt || "tracker.xlsx";
}

function sha256Hex(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function preflightStatus(code: string): number {
  return code === "too_large" ? 413 : 422;
}

async function markFailed(supabase: ReturnType<typeof createAdminClient>, importId: string, message: string) {
  await supabase
    .from("opencode_go_imports")
    .update({
      status: "failed",
      error_message: message.slice(0, 2000),
      processed_at: new Date().toISOString(),
    })
    .eq("id", importId);
}

export async function POST(request: Request) {
  if (!isTelemetryConfigured()) {
    return NextResponse.json(
      { error: "Supabase telemetry is not configured." },
      { status: 503 },
    );
  }

  const access = await getObservatoryAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!access.authorized) {
    return NextResponse.json({ error: "Observatory access denied." }, { status: 403 });
  }

  if (isCrossOriginRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin mutations are not allowed." },
      { status: 403 },
    );
  }

  if (requestExceedsBytes(request, OPENCODE_GO_MAX_REQUEST_BYTES)) {
    return NextResponse.json({ error: "Import request is too large." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "An OpenCode Go .xlsx file is required." }, { status: 400 });
  }
  if (!/\.xlsx$/i.test(file.name.trim())) {
    return NextResponse.json(
      { error: "Unsupported OpenCode Go tracker format. Expected an .xlsx workbook." },
      { status: 422 },
    );
  }
  if (file.size <= 0 || file.size > OPENCODE_GO_MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: "XLSX file must be between 1 byte and 8 MB." },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    preflightXlsxBuffer(buffer, file.name);
  } catch (error) {
    const code = error instanceof XlsxPreflightError ? error.code : "malformed";
    const message =
      code === "too_large"
        ? "XLSX file is too large."
        : code === "macro"
          ? "Workbook macros/VBA content is not supported."
          : code === "encrypted"
            ? "Encrypted workbooks are not supported."
            : code === "traversal"
              ? "Workbook contains unsafe archive entries."
              : code === "not_zip" || code === "malformed"
                ? "File is not a valid .xlsx workbook."
                : "Unsupported OpenCode Go tracker format.";
    return NextResponse.json({ error: message }, { status: preflightStatus(code) });
  }

  const rawSha = sha256Hex(buffer);
  const supabase = createAdminClient();

  const { data: existing, error: existingError } = await supabase
    .from("opencode_go_imports")
    .select("id,status")
    .eq("raw_sha256", rawSha)
    .in("status", ["processing", "processed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: "Could not check import deduplication state." }, { status: 500 });
  }
  if (existing?.status === "processing") {
    return NextResponse.json(
      { error: "This exact workbook is already processing.", importId: existing.id },
      { status: 409 },
    );
  }
  if (existing?.status === "processed") {
    const duplicateId = randomUUID();
    const { error: duplicateError } = await supabase.from("opencode_go_imports").insert({
      id: duplicateId,
      filename: safeFilename(file.name),
      file_size_bytes: file.size,
      raw_sha256: rawSha,
      status: "exact_duplicate",
      duplicate_of_import_id: existing.id,
      processed_at: new Date().toISOString(),
    });
    if (duplicateError) {
      return NextResponse.json({ error: "Could not record the duplicate import." }, { status: 500 });
    }
    return NextResponse.json({
      status: "exact_duplicate",
      importId: duplicateId,
      duplicateOfImportId: existing.id,
    });
  }

  let parsed: ReturnType<typeof parseOpenCodeGoWorkbook>;
  try {
    parsed = parseOpenCodeGoWorkbook(buffer);
  } catch (error) {
    const message =
      error instanceof OpenCodeGoParseError
        ? error.message.replace(/^[a-z_]+: /, "")
        : "Unsupported OpenCode Go tracker format.";
    return NextResponse.json(
      { error: `Unsupported OpenCode Go tracker format. ${message}` },
      { status: 422 },
    );
  }

  const planned = plannedCeiling({ hardLimit: parsed.hardLimit, safetyReserve: parsed.safetyReserve });
  const ceilings = parsed.checkpoints.map((c) => ({
    ...c,
    ceiling: checkpointCeiling({
      checkpointMs: c.timestampMs,
      trackingStartMs: parsed.trackingStartMs,
      resetAtMs: parsed.resetAtMs,
      baselineUsage: parsed.baselineUsage,
      plannedCeilingValue: planned,
    }),
  }));
  const latest = latestRecordedActual(
    ceilings.map((c) => ({ timestampMs: c.timestampMs, date: c.date, timestamp: new Date(c.timestampMs).toISOString(), actual: c.actual })),
    parsed.baselineUsage,
  );
  const reconciliation = reconcileFormulas(parsed);
  const remaining = budgetRemaining(planned, latest.value);

  const trackingStartIso = new Date(parsed.trackingStartMs).toISOString();
  const resetAtIso = new Date(parsed.resetAtMs).toISOString();

  const { data: previous, error: previousError } = await supabase
    .from("opencode_go_imports")
    .select("*")
    .eq("status", "processed")
    .eq("tracking_start", trackingStartIso)
    .eq("reset_at", resetAtIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (previousError) {
    return NextResponse.json({ error: "Could not read accepted import history." }, { status: 500 });
  }

  if (previous) {
    const prevSnapshot = (previous.parsed_snapshot ?? {}) as {
      baselineUsage?: number;
      hardLimit?: number;
      safetyReserve?: number;
      plannedCeiling?: number;
      checkTime?: string;
      checkpoints?: { date: string; actual: number | null }[];
    };
    try {
      validateSameCyclePlan(
        {
          baselineUsage: prevSnapshot.baselineUsage as number,
          hardLimit: prevSnapshot.hardLimit as number,
          safetyReserve: prevSnapshot.safetyReserve as number,
          plannedCeiling: prevSnapshot.plannedCeiling as number,
          checkTime: prevSnapshot.checkTime as string,
          schedule: (prevSnapshot.checkpoints ?? []).map((c) => c.date),
        },
        {
          baselineUsage: parsed.baselineUsage,
          hardLimit: parsed.hardLimit,
          safetyReserve: parsed.safetyReserve,
          plannedCeiling: planned,
          checkTime: parsed.checkTime,
          schedule: ceilings.map((c) => c.date),
        },
      );
      validateCorrection(
        (prevSnapshot.checkpoints ?? []).map((c) => ({ date: c.date, actual: c.actual })),
        ceilings.map((c) => ({ date: c.date, actual: c.actual })),
      );
    } catch (error) {
      if (error instanceof OpenCodeGoConflictError) {
        if (error.code === "monotonic") {
          return NextResponse.json({ error: error.message }, { status: 422 });
        }
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      return NextResponse.json({ error: "Could not validate import history." }, { status: 500 });
    }
  }

  const importId = randomUUID();
  const storagePath = `${importId}/${safeFilename(file.name)}`;

  const { error: insertError } = await supabase.from("opencode_go_imports").insert({
    id: importId,
    filename: safeFilename(file.name),
    file_size_bytes: file.size,
    raw_sha256: rawSha,
    tracking_start: trackingStartIso,
    reset_at: resetAtIso,
    check_time: parsed.checkTime,
    status: "processing",
  });

  if (insertError) {
    const { data: raced } = await supabase
      .from("opencode_go_imports")
      .select("id")
      .eq("raw_sha256", rawSha)
      .in("status", ["processing", "processed"])
      .limit(1)
      .maybeSingle();
    if (raced) {
      return NextResponse.json(
        { error: "This exact workbook was claimed by another import.", duplicateOfImportId: (raced as { id: string }).id },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Could not create the import record." }, { status: 500 });
  }

  const { error: storageError } = await supabase.storage
    .from(OPENCODE_GO_BUCKET)
    .upload(storagePath, buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });

  if (storageError) {
    await markFailed(supabase, importId, storageError.message);
    return NextResponse.json({ error: "Raw file storage failed." }, { status: 500 });
  }

  const parsedSnapshot = {
    timezone: "Africa/Casablanca",
    trackingStartsAt: trackingStartIso,
    resetAt: resetAtIso,
    checkTime: parsed.checkTime,
    baselineUsage: parsed.baselineUsage,
    hardLimit: parsed.hardLimit,
    safetyReserve: parsed.safetyReserve,
    plannedCeiling: planned,
    checkpoints: ceilings.map((c, i) => ({
      day: c.day,
      date: c.date,
      checkTime: c.checkTime,
      timestamp: new Date(c.timestampMs).toISOString(),
      ceiling: c.ceiling,
      workbookCeiling: parsed.checkpoints[i]?.ceiling ?? null,
      actual: c.actual,
    })),
    latestRecordedActual: latest,
    workbookDiagnostics: {
      formulaValuesAvailable: reconciliation.formulaValuesAvailable,
      formulaMismatchCount: reconciliation.mismatchCount,
      formulaWarnings: reconciliation.warnings.slice(0, 50),
    },
  };

  const { error: finalizeError } = await supabase
    .from("opencode_go_imports")
    .update({
      status: "processed",
      storage_path: storagePath,
      baseline_usage: parsed.baselineUsage,
      hard_limit: parsed.hardLimit,
      safety_reserve: parsed.safetyReserve,
      planned_ceiling: planned,
      latest_actual_usage: latest.value,
      latest_actual_date: latest.checkpointDate,
      parsed_snapshot: parsedSnapshot,
      formula_mismatch_count: reconciliation.mismatchCount,
      formula_warnings: reconciliation.warnings.slice(0, 50),
      processed_at: new Date().toISOString(),
    })
    .eq("id", importId)
    .eq("status", "processing");

  if (finalizeError) {
    let cleanupOk = false;
    try {
      const { error: removeError } = await supabase.storage.from(OPENCODE_GO_BUCKET).remove([storagePath]);
      cleanupOk = !removeError;
    } catch {
      cleanupOk = false;
    }
    console.error(
      JSON.stringify({
        scope: "opencode-go-import",
        importId,
        storagePath,
        cleanupAttempted: true,
        cleanupOk,
      }),
    );
    await markFailed(supabase, importId, finalizeError.message);
    return NextResponse.json({ error: "Database promotion failed." }, { status: 500 });
  }

  return NextResponse.json({
    status: "processed",
    importId,
    cycle: { trackingStart: trackingStartIso, resetAt: resetAtIso },
    checkpointCount: ceilings.length,
    latestRecordedActual: latest,
    budgetRemaining: remaining,
    formulaMismatchCount: reconciliation.mismatchCount,
    formulaWarnings: reconciliation.warnings.slice(0, 50),
  });
}
