import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { getObservatoryAccess } from "@/lib/auth/require-user";
import { analyzeCrossMachineDuplicates } from "@/lib/ccusage/cross-machine-dedupe";
import {
  diffDailyModelUsage,
  diffDailyUsage,
} from "@/lib/ccusage/diff";
import { sha256Buffer } from "@/lib/ccusage/hash";
import { parseCcusageDaily } from "@/lib/ccusage/parser";
import type {
  CurrentDailyModelUsageRow,
  CurrentDailyUsageRow,
  StoredSessionEvidenceRow,
} from "@/lib/ccusage/types";
import {
  decodeUtf8Strict,
  isCrossOriginRequest,
  requestExceedsBytes,
} from "@/lib/http/request";
import { createAdminClient, isTelemetryConfigured } from "@/lib/supabase/admin";
import {
  buildCcusageCommand,
  isFutureTelemetryDate,
  MAX_COMMAND_USED_CHARS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_REQUEST_BYTES,
  nextSinceFromDate,
  RAW_IMPORT_BUCKET,
  STALE_IMPORT_MINUTES,
  SUPPORTED_CCUSAGE_VERSION,
  TELEMETRY_TIMEZONE,
  todayInTelemetryTimezone,
} from "@/lib/telemetry/config";

function safeFilename(name: string) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
  return cleaned || "ccusage.json";
}

async function markFailed(importId: string, message: string) {
  const supabase = createAdminClient();
  await supabase
    .from("imports")
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
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  if (!access.authorized) {
    return NextResponse.json(
      { error: "Observatory access denied." },
      { status: 403 },
    );
  }

  if (isCrossOriginRequest(request)) {
    return NextResponse.json(
      { error: "Cross-origin mutations are not allowed." },
      { status: 403 },
    );
  }

  if (requestExceedsBytes(request, MAX_IMPORT_REQUEST_BYTES)) {
    return NextResponse.json(
      { error: "Import request is too large." },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart form data." },
      { status: 400 },
    );
  }

  const machineId =
    typeof form.get("machine_id") === "string"
      ? String(form.get("machine_id")).trim().toLowerCase()
      : "";
  const commandUsed =
    typeof form.get("command_used") === "string"
      ? String(form.get("command_used")).trim()
      : null;
  const file = form.get("file");

  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(machineId)) {
    return NextResponse.json(
      { error: "A valid machine ID is required." },
      { status: 400 },
    );
  }

  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "A ccusage JSON file is required." },
      { status: 400 },
    );
  }

  if (
    commandUsed &&
    (commandUsed.length > MAX_COMMAND_USED_CHARS ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(commandUsed))
  ) {
    return NextResponse.json(
      { error: "Collection command metadata is invalid or too long." },
      { status: 400 },
    );
  }

  if (file.size <= 0 || file.size > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: "JSON file must be between 1 byte and 8 MB." },
      { status: 413 },
    );
  }

  const supabase = createAdminClient();
  const { data: machine, error: machineError } = await supabase
    .from("machines")
    .select("id,name")
    .eq("id", machineId)
    .eq("is_active", true)
    .maybeSingle();

  if (machineError) {
    return NextResponse.json(
      { error: "Could not validate the machine." },
      { status: 500 },
    );
  }

  if (!machine) {
    return NextResponse.json(
      { error: "Unknown or inactive machine." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const rawSha = sha256Buffer(buffer);

  let decoded: string;
  try {
    decoded = decodeUtf8Strict(buffer);
  } catch {
    return NextResponse.json(
      { error: "File is not valid UTF-8." },
      { status: 400 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decoded);
  } catch {
    return NextResponse.json(
      { error: "File is not valid JSON." },
      { status: 400 },
    );
  }

  let parsed;
  try {
    parsed = parseCcusageDaily(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unsupported ccusage JSON.",
      },
      { status: 422 },
    );
  }

  if (isFutureTelemetryDate(parsed.scopeEnd)) {
    return NextResponse.json(
      {
        error:
          "Snapshot contains future-dated usage through " +
          parsed.scopeEnd +
          "; current telemetry date is " +
          todayInTelemetryTimezone() +
          ".",
      },
      { status: 422 },
    );
  }

  const staleBefore = new Date(
    Date.now() - STALE_IMPORT_MINUTES * 60 * 1000,
  ).toISOString();
  const { error: staleRecoveryError } = await supabase
    .from("imports")
    .update({
      status: "failed",
      error_message: "Recovered stale processing import.",
      processed_at: new Date().toISOString(),
    })
    .eq("machine_id", machineId)
    .eq("status", "processing")
    .lt("created_at", staleBefore);

  if (staleRecoveryError) {
    return NextResponse.json(
      { error: "Could not recover stale imports." },
      { status: 500 },
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("imports")
    .select("id,machine_id,scope_end,status")
    .eq("machine_id", machineId)
    .eq("raw_sha256", rawSha)
    .in("status", ["processing", "processed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json(
      { error: "Could not check import deduplication state." },
      { status: 500 },
    );
  }

  if (existing?.status === "processing") {
    return NextResponse.json(
      {
        error: "This exact dataset is already processing for this machine.",
        importId: existing.id,
      },
      { status: 409 },
    );
  }

  if (existing?.status === "processed") {
    let modelBackfilled = 0;
    let sessionBackfilled = 0;

    if (parsed.modelRows.length > 0) {
      const { data: modelBackfill, error: modelBackfillError } =
        await supabase.rpc("backfill_ccusage_models", {
          p_import_id: existing.id,
          p_model_rows: parsed.modelRows,
        });

      if (modelBackfillError) {
        return NextResponse.json(
          { error: "Could not backfill model telemetry for this import." },
          { status: 500 },
        );
      }

      modelBackfilled = Number(modelBackfill?.insertedModelRows ?? 0);
    }

    if (parsed.sessionRows.length > 0) {
      const { data: sessionBackfill, error: sessionBackfillError } =
        await supabase.rpc("backfill_ccusage_sessions", {
          p_import_id: existing.id,
          p_session_rows: parsed.sessionRows,
        });

      if (sessionBackfillError) {
        return NextResponse.json(
          { error: "Could not backfill session dedupe evidence for this import." },
          { status: 500 },
        );
      }

      sessionBackfilled = Number(
        sessionBackfill?.insertedSessionRows ?? 0,
      );
    }

    const duplicateId = randomUUID();
    const { error: duplicateAuditError } = await supabase.from("imports").insert({
      id: duplicateId,
      machine_id: machineId,
      filename: safeFilename(file.name),
      file_size_bytes: file.size,
      raw_sha256: rawSha,
      ccusage_version: SUPPORTED_CCUSAGE_VERSION,
      command_used: commandUsed,
      timezone: TELEMETRY_TIMEZONE,
      status: "exact_duplicate",
      duplicate_of_import_id: existing.id,
      processed_at: new Date().toISOString(),
    });

    if (duplicateAuditError) {
      return NextResponse.json(
        { error: "Could not record the duplicate import." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      status: "exact_duplicate",
      importId: duplicateId,
      duplicateOfImportId: existing.id,
      crossMachineMatch: false,
      modelBackfilled,
      sessionBackfilled,
      sessionEvidenceCount: parsed.sessionRows.length,
      models: parsed.models,
      nextCommand: existing.scope_end
        ? buildCcusageCommand(nextSinceFromDate(existing.scope_end))
        : undefined,
    });
  }

  const { data: latestAccepted, error: latestAcceptedError } = await supabase
    .from("imports")
    .select("scope_end")
    .eq("machine_id", machineId)
    .eq("status", "processed")
    .not("scope_end", "is", null)
    .order("scope_end", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestAcceptedError) {
    return NextResponse.json(
      { error: "Could not read accepted import history." },
      { status: 500 },
    );
  }

  if (
    latestAccepted?.scope_end &&
    parsed.scopeEnd < latestAccepted.scope_end
  ) {
    return NextResponse.json(
      {
        error:
          "This snapshot ends before the latest accepted machine history (" +
          latestAccepted.scope_end +
          "). Generate a current overlapping export instead.",
      },
      { status: 409 },
    );
  }

  const { data: sameHashElsewhere, error: crossMachineError } = await supabase
    .from("imports")
    .select("id,machine_id")
    .eq("raw_sha256", rawSha)
    .eq("status", "processed")
    .neq("machine_id", machineId)
    .limit(1)
    .maybeSingle();

  if (crossMachineError) {
    return NextResponse.json(
      { error: "Could not check cross-machine provenance." },
      { status: 500 },
    );
  }

  const { data: inFlight, error: inFlightError } = await supabase
    .from("imports")
    .select("id,created_at")
    .eq("machine_id", machineId)
    .eq("status", "processing")
    .limit(1)
    .maybeSingle();

  if (inFlightError) {
    return NextResponse.json(
      { error: "Could not check machine import state." },
      { status: 500 },
    );
  }

  if (inFlight) {
    return NextResponse.json(
      {
        error:
          "Another import is already processing for this machine. Retry after it finishes.",
        importId: inFlight.id,
      },
      { status: 409 },
    );
  }

  const importId = randomUUID();
  const storagePath =
    machineId + "/" + importId + "/" + safeFilename(file.name || "ccusage.json");

  const { error: importError } = await supabase.from("imports").insert({
    id: importId,
    machine_id: machineId,
    storage_path: storagePath,
    filename: safeFilename(file.name),
    file_size_bytes: file.size,
    raw_sha256: rawSha,
    ccusage_version: SUPPORTED_CCUSAGE_VERSION,
    command_used: commandUsed,
    timezone: TELEMETRY_TIMEZONE,
    scope_start: parsed.scopeStart,
    scope_end: parsed.scopeEnd,
    status: "processing",
    cross_machine_match: Boolean(sameHashElsewhere),
  });

  if (importError) {
    const { data: racedHash } = await supabase
      .from("imports")
      .select("id,machine_id")
      .eq("machine_id", machineId)
      .eq("raw_sha256", rawSha)
      .in("status", ["processing", "processed"])
      .limit(1)
      .maybeSingle();

    if (racedHash) {
      return NextResponse.json(
        {
          error:
            "This exact dataset was claimed by another import. Retry to record it as a duplicate.",
          duplicateOfImportId: racedHash.id,
          duplicateOfMachineId: racedHash.machine_id,
        },
        { status: 409 },
      );
    }

    const { data: racedMachine } = await supabase
      .from("imports")
      .select("id")
      .eq("machine_id", machineId)
      .eq("status", "processing")
      .limit(1)
      .maybeSingle();

    if (racedMachine) {
      return NextResponse.json(
        {
          error:
            "Another import started for this machine. Retry after it finishes.",
          importId: racedMachine.id,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Could not create the import record." },
      { status: 500 },
    );
  }

  const { error: storageError } = await supabase.storage
    .from(RAW_IMPORT_BUCKET)
    .upload(storagePath, buffer, {
      contentType: "application/json",
      upsert: false,
    });

  if (storageError) {
    await markFailed(importId, storageError.message);
    return NextResponse.json(
      { error: "Raw file storage failed." },
      { status: 500 },
    );
  }

  const { data: currentData, error: currentError } = await supabase
    .from("v_current_daily_usage")
    .select("*")
    .eq("machine_id", machineId);

  if (currentError) {
    await markFailed(importId, currentError.message);
    return NextResponse.json(
      { error: "Could not read canonical usage state." },
      { status: 500 },
    );
  }

  const { data: currentModelData, error: currentModelError } = await supabase
    .from("v_current_daily_model_usage")
    .select("*")
    .eq("machine_id", machineId);

  if (currentModelError) {
    await markFailed(importId, currentModelError.message);
    return NextResponse.json(
      { error: "Could not read canonical model usage state." },
      { status: 500 },
    );
  }

  const { data: otherDailyData, error: otherDailyError } = await supabase
    .from("v_current_daily_usage_dedupe")
    .select("*")
    .neq("machine_id", machineId)
    .eq("global_duplicate", false);

  if (otherDailyError) {
    await markFailed(importId, otherDailyError.message);
    return NextResponse.json(
      { error: "Could not read cross-machine daily evidence." },
      { status: 500 },
    );
  }

  const { data: otherSessionData, error: otherSessionError } = await supabase
    .from("session_usage_observations")
    .select("*")
    .neq("machine_id", machineId)
    .in("agent", parsed.agents);

  if (otherSessionError) {
    await markFailed(importId, otherSessionError.message);
    return NextResponse.json(
      { error: "Could not read cross-machine session evidence." },
      { status: 500 },
    );
  }

  const expectedOverlapStart = latestAccepted?.scope_end
    ? nextSinceFromDate(latestAccepted.scope_end)
    : null;
  const coverageStart =
    expectedOverlapStart && expectedOverlapStart < parsed.scopeStart
      ? expectedOverlapStart
      : parsed.scopeStart;

  const diff = diffDailyUsage(
    parsed.rows,
    (currentData ?? []) as CurrentDailyUsageRow[],
    {
      scopeStart: coverageStart,
      scopeEnd: parsed.scopeEnd,
    },
  );
  const rowsToWrite = [
    ...diff.newRows,
    ...diff.revisedRows,
    ...diff.removedRows,
  ];

  const modelDiff = diffDailyModelUsage(
    parsed.modelRows,
    (currentModelData ?? []) as CurrentDailyModelUsageRow[],
    {
      scopeStart: coverageStart,
      scopeEnd: parsed.scopeEnd,
    },
  );
  const modelRowsToWrite = [
    ...modelDiff.newRows,
    ...modelDiff.revisedRows,
    ...modelDiff.removedRows,
  ];

  const crossMachineAnalysis = analyzeCrossMachineDuplicates({
    incomingDaily: parsed.rows,
    incomingSessions: parsed.sessionRows,
    existingDaily: (otherDailyData ?? []) as CurrentDailyUsageRow[],
    existingSessions: (otherSessionData ?? []) as StoredSessionEvidenceRow[],
    rawDuplicateMachineId: sameHashElsewhere?.machine_id ?? null,
  });

  const writtenDailyKeys = new Set(
    rowsToWrite
      .filter((row) => !row.is_tombstone)
      .map((row) => row.agent + "|" + row.usage_date),
  );
  const dedupeLinks = crossMachineAnalysis.links.filter((link) =>
    writtenDailyKeys.has(link.agent + "|" + link.usage_date),
  );
  const duplicateTokensPrevented = dedupeLinks.reduce((total, link) => {
    const row = rowsToWrite.find(
      (item) =>
        item.agent === link.agent &&
        item.usage_date === link.usage_date &&
        !item.is_tombstone,
    );
    return total + (row?.reported_total_tokens ?? 0);
  }, 0);
  const sessionMatchDetected =
    crossMachineAnalysis.exactSessionMatches > 0 ||
    crossMachineAnalysis.identityMatches > 0;
  const crossMachineMatch =
    Boolean(sameHashElsewhere) || sessionMatchDetected;

  const summary = {
    new: diff.newRows.length,
    revised: diff.revisedRows.length,
    removed: diff.removedRows.length,
    unchanged: diff.unchangedRows.length,
    beforeTotal: diff.beforeTotal,
    afterTotal: diff.afterTotal,
    netChange: diff.netChange,
    agents: parsed.agents,
    models: parsed.models,
    modelChanges: {
      new: modelDiff.newRows.length,
      revised: modelDiff.revisedRows.length,
      removed: modelDiff.removedRows.length,
      unchanged: modelDiff.unchangedRows.length,
    },
    scopeStart: parsed.scopeStart,
    scopeEnd: parsed.scopeEnd,
    warnings: parsed.warnings,
    sourceShape: parsed.sourceShape,
    crossMachineMatch,
    sessionEvidence: {
      imported: parsed.sessionRows.length,
      exactCrossMachineMatches: crossMachineAnalysis.exactSessionMatches,
      identityCrossMachineMatches: crossMachineAnalysis.identityMatches,
      partialMirrorRisk: crossMachineAnalysis.partialMirrorRisk,
      strongMirrors: crossMachineAnalysis.evidence
        .filter((item) => item.strong)
        .map((item) => ({
          machineId: item.machineId,
          agent: item.agent,
          exactSessionMatches: item.exactSessionMatches,
          exactOverlapRatio: item.exactOverlapRatio,
          evidenceStart: item.evidenceStart,
          evidenceEnd: item.evidenceEnd,
        })),
    },
    globalDedupe: {
      rowsSuppressed: dedupeLinks.length,
      duplicateTokensPrevented,
    },
  };

  const { error: rpcError } = await supabase.rpc("process_ccusage_import_v3", {
    p_import_id: importId,
    p_rows: rowsToWrite,
    p_model_rows: modelRowsToWrite,
    p_session_rows: parsed.sessionRows,
    p_dedupe_links: dedupeLinks,
    p_summary: summary,
  });

  if (rpcError) {
    await markFailed(importId, rpcError.message);
    return NextResponse.json(
      { error: "Database promotion failed." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "processed",
    importId,
    crossMachineMatch,
    duplicateOfMachineId:
      sameHashElsewhere?.machine_id ??
      crossMachineAnalysis.evidence.find((item) => item.strong)?.machineId,
    summary,
    nextCommand: buildCcusageCommand(nextSinceFromDate(parsed.scopeEnd)),
  });
}
