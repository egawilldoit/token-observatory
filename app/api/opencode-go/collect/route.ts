import { NextResponse } from "next/server";

import { collectProviderUsage } from "@/lib/opencode-go/collect";
import { getOpenCodeGoApiKey } from "@/lib/opencode-go/provider";
import { createAdminClient, isTelemetryConfigured } from "@/lib/supabase/admin";

/**
 * V2 background collection (Vercel Cron only — least privilege).
 *
 * Authentication is `CRON_SECRET` only: the request must carry
 * `Authorization: Bearer <CRON_SECRET>`. Normal observatory browser sessions
 * are NOT accepted here; interactive refreshes use POST
 * /api/opencode-go/refresh instead. HTTP semantics live in
 * `lib/opencode-go/collect.ts` (unit-tested); this handler only wires
 * server values. No Authorization/key value appears in logs, errors, or
 * responses.
 */
async function handle(request: Request) {
  const result = await collectProviderUsage({
    telemetryConfigured: isTelemetryConfigured(),
    cronSecret: process.env.CRON_SECRET?.trim() || null,
    authHeader: request.headers.get("authorization"),
    apiKey: getOpenCodeGoApiKey(),
    nowMs: Date.now(),
    getClient: () => createAdminClient(),
  });
  return NextResponse.json(result.body, { status: result.status });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
