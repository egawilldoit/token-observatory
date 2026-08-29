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

  const supabase = createAdminClient();
  const { data: imports, error: importError } = await supabase
    .from("imports")
    .select("id,machine_id,storage_path,created_at")
    .eq("status", "processed")
    .not("storage_path", "is", null)
    .order("created_at", { ascending: true })
    .limit(20);

  if (importError) {
    return NextResponse.json(
      { error: "Could not read stored import provenance." },
      { status: 500 },
    );
  }

  let processedImports = 0;
  let insertedModelRows = 0;
  const models = new Set<string>();
  const warnings: string[] = [];

  for (const item of imports ?? []) {
    const { data: existing, error: existingError } = await supabase
      .from("daily_model_usage_observations")
      .select("id")
      .eq("import_id", item.id)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { error: "Could not inspect model backfill state." },
        { status: 500 },
      );
    }

    if (existing) continue;

    const storagePath =
      typeof item.storage_path === "string" ? item.storage_path : null;
    if (!storagePath) continue;

    const { data: blob, error: downloadError } = await supabase.storage
      .from(RAW_IMPORT_BUCKET)
      .download(storagePath);

    if (downloadError || !blob) {
      warnings.push(
        "Could not read raw snapshot for import " + String(item.id).slice(0, 8) + ".",
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
        (error instanceof Error ? error.message : "Could not parse stored snapshot.") +
          " [import " +
          String(item.id).slice(0, 8) +
          "]",
      );
      continue;
    }

    if (parsed.modelRows.length === 0) {
      warnings.push(
        "No model breakdown found in import " + String(item.id).slice(0, 8) + ".",
      );
      continue;
    }

    const { data: result, error: rpcError } = await supabase.rpc(
      "backfill_ccusage_models",
      {
        p_import_id: item.id,
        p_model_rows: parsed.modelRows,
      },
    );

    if (rpcError) {
      return NextResponse.json(
        { error: "Database model backfill failed." },
        { status: 500 },
      );
    }

    processedImports += 1;
    insertedModelRows += Number(result?.insertedModelRows ?? 0);
    for (const model of parsed.models) models.add(model);
  }

  return NextResponse.json({
    status: "processed",
    processedImports,
    insertedModelRows,
    models: [...models].sort(),
    warnings,
  });
}
