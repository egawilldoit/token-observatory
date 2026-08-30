import { NextResponse } from "next/server";

import { getObservatoryAccess } from "@/lib/auth/require-user";
import { parseCcusageDaily } from "@/lib/ccusage/parser";
import { decodeUtf8Strict, isCrossOriginRequest } from "@/lib/http/request";
import { createAdminClient, isTelemetryConfigured } from "@/lib/supabase/admin";
import { RAW_IMPORT_BUCKET } from "@/lib/telemetry/config";

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Expected JSON request body." },
      { status: 400 },
    );
  }

  const machineId =
    body &&
    typeof body === "object" &&
    typeof (body as { machineId?: unknown }).machineId === "string"
      ? String((body as { machineId: string }).machineId)
          .trim()
          .toLowerCase()
      : "";

  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(machineId)) {
    return NextResponse.json(
      { error: "A valid machine ID is required." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data: machine, error: machineError } = await supabase
    .from("machines")
    .select("id")
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

  const { data: imports, error: importError } = await supabase
    .from("imports")
    .select("id,storage_path,created_at")
    .eq("machine_id", machineId)
    .eq("status", "processed")
    .not("storage_path", "is", null)
    .order("created_at", { ascending: true })
    .limit(50);

  if (importError) {
    return NextResponse.json(
      { error: "Could not read stored import provenance." },
      { status: 500 },
    );
  }

  let processedImports = 0;
  let insertedSessionRows = 0;
  let parsedSessionRows = 0;
  const warnings: string[] = [];

  for (const item of imports ?? []) {
    const storagePath =
      typeof item.storage_path === "string" ? item.storage_path : null;
    if (!storagePath) continue;

    const { data: blob, error: downloadError } = await supabase.storage
      .from(RAW_IMPORT_BUCKET)
      .download(storagePath);

    if (downloadError || !blob) {
      warnings.push(
        "Could not read raw snapshot for import " +
          String(item.id).slice(0, 8) +
          ".",
      );
      continue;
    }

    let payload: unknown;
    try {
      const buffer = new Uint8Array(await blob.arrayBuffer());
      payload = JSON.parse(decodeUtf8Strict(buffer));
    } catch {
      warnings.push(
        "Stored snapshot is not valid ccusage JSON for import " +
          String(item.id).slice(0, 8) +
          ".",
      );
      continue;
    }

    let parsed;
    try {
      parsed = parseCcusageDaily(payload);
    } catch (error) {
      warnings.push(
        (error instanceof Error
          ? error.message
          : "Could not parse stored snapshot.") +
          " [import " +
          String(item.id).slice(0, 8) +
          "]",
      );
      continue;
    }

    if (parsed.sessionRows.length === 0) {
      warnings.push(
        "No session section found in import " +
          String(item.id).slice(0, 8) +
          ". Future exports should use --sections daily,session.",
      );
      continue;
    }

    const { data: result, error: rpcError } = await supabase.rpc(
      "backfill_ccusage_sessions",
      {
        p_import_id: item.id,
        p_session_rows: parsed.sessionRows,
      },
    );

    if (rpcError) {
      return NextResponse.json(
        { error: "Database session evidence backfill failed." },
        { status: 500 },
      );
    }

    processedImports += 1;
    parsedSessionRows += parsed.sessionRows.length;
    insertedSessionRows += Number(result?.insertedSessionRows ?? 0);
  }

  return NextResponse.json({
    status: "processed",
    machineId,
    processedImports,
    parsedSessionRows,
    insertedSessionRows,
    warnings,
  });
}
