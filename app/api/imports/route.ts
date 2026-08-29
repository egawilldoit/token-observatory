import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { hasObservatoryAccess } from "@/lib/auth/require-user";
import { diffDailyUsage } from "@/lib/ccusage/diff";
import { sha256Buffer } from "@/lib/ccusage/hash";
import { parseCcusageDaily } from "@/lib/ccusage/parser";
import type { CurrentDailyUsageRow } from "@/lib/ccusage/types";
import { createAdminClient, isTelemetryConfigured } from "@/lib/supabase/admin";
import {
  buildCcusageCommand,
  MAX_IMPORT_BYTES,
  nextSinceFromDate,
  RAW_IMPORT_BUCKET,
  STALE_IMPORT_MINUTES,
  SUPPORTED_CCUSAGE_VERSION,
  TELEMETRY_TIMEZONE,
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

  if (!(await hasObservatoryAccess())) {
    return NextResponse.json({ error: "Observatory access denied." }, { status: 403 });
  }

  const form = await request.formData();
  const machineId =
    typeof form.get("machine_id") === "string"
      ? String(form.get("machine_id")).trim()
      : "";
  const commandUsed =
    typeof form.get("command_used") === "string"
      ? String(form.get("command_used")).trim()
      : null;
  const file = form.get("file");

  if (!machineId || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Machine and JSON file are required." },
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

  if (machineError || !machine) {
    return NextResponse.json(
      { error: "Unknown or inactive machine." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const rawSha = sha256Buffer(buffer);

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
      { error: "Could not recover stale imports: " + staleRecoveryError.message },
      { status: 500 },
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("imports")
    .select("id,machine_id,scope_end")
    .eq("machine_id", machineId)
    .eq("raw_sha256", rawSha)
    .in("status", ["processing", "processed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 500 });
  }

  if (existing) {
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
        { error: "Could not record duplicate import: " + duplicateAuditError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      status: "exact_duplicate",
      importId: duplicateId,
      duplicateOfImportId: existing.id,
      crossMachineMatch: Boolean(sameHashElsewhere),
      nextCommand: existing.scope_end
        ? buildCcusageCommand(nextSinceFromDate(existing.scope_end))
        : undefined,
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(buffer.toString("utf8"));
  } catch {
    return NextResponse.json(
      { error: "File is not valid UTF-8 JSON." },
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

  const { data: sameHashElsewhere, error: crossMachineError } = await supabase
    .from("imports")
    .select("id,machine_id")
    .eq("raw_sha256", rawSha)
    .eq("status", "processed")
    .neq("machine_id", machineId)
    .limit(1)
    .maybeSingle();

  if (crossMachineError) {
    return NextResponse.json({ error: crossMachineError.message }, { status: 500 });
  }

  const { data: inFlight, error: inFlightError } = await supabase
    .from("imports")
    .select("id,created_at")
    .eq("machine_id", machineId)
    .eq("status", "processing")
    .limit(1)
    .maybeSingle();

  if (inFlightError) {
    return NextResponse.json({ error: inFlightError.message }, { status: 500 });
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
          error: "This exact dataset was claimed by another import. Retry to record it as a duplicate.",
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

    return NextResponse.json({ error: importError.message }, { status: 500 });
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
      { error: "Raw file storage failed: " + storageError.message },
      { status: 500 },
    );
  }

  const { data: currentData, error: currentError } = await supabase
    .from("v_current_daily_usage")
    .select("*")
    .eq("machine_id", machineId);

  if (currentError) {
    await markFailed(importId, currentError.message);
    return NextResponse.json({ error: currentError.message }, { status: 500 });
  }

  const diff = diffDailyUsage(
    parsed.rows,
    (currentData ?? []) as CurrentDailyUsageRow[],
  );
  const rowsToWrite = [...diff.newRows, ...diff.revisedRows];

  const summary = {
    new: diff.newRows.length,
    revised: diff.revisedRows.length,
    unchanged: diff.unchangedRows.length,
    beforeTotal: diff.beforeTotal,
    afterTotal: diff.afterTotal,
    netChange: diff.netChange,
    agents: parsed.agents,
    scopeStart: parsed.scopeStart,
    scopeEnd: parsed.scopeEnd,
    warnings: parsed.warnings,
    sourceShape: parsed.sourceShape,
    crossMachineMatch: false,
  };

  const { error: rpcError } = await supabase.rpc("process_ccusage_import", {
    p_import_id: importId,
    p_rows: rowsToWrite,
    p_summary: summary,
  });

  if (rpcError) {
    await markFailed(importId, rpcError.message);
    return NextResponse.json(
      { error: "Database promotion failed: " + rpcError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "processed",
    importId,
    crossMachineMatch: Boolean(sameHashElsewhere),
    duplicateOfMachineId: sameHashElsewhere?.machine_id,
    summary,
    nextCommand: buildCcusageCommand(nextSinceFromDate(parsed.scopeEnd)),
  });
}
