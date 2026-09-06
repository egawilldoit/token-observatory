import { NextResponse } from "next/server";

import { refreshProviderSnapshot } from "@/lib/opencode-go/refresh";
import { getOpenCodeGoApiKey } from "@/lib/opencode-go/provider";
import { createAdminClient, isTelemetryConfigured } from "@/lib/supabase/admin";

/**
 * V2 background collection (Vercel Cron only — least privilege).
 *
 * Authentication is `CRON_SECRET` only: the request must carry
 * `Authorization: Bearer <CRON_SECRET>`. Normal observatory browser sessions
 * are NOT accepted here; interactive refreshes use POST
 * /api/opencode-go/refresh instead. When `CRON_SECRET` is not configured the
 * endpoint reports 503 so a missing secret can never silently disable
 * collection.
 *
 * The handler never exposes the OpenCode Go API key and never writes
 * contract data. No Authorization/key value appears in logs, errors, or
 * responses.
 */
function cronAuthorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;
  const header = request.headers.get("authorization")?.trim();
  if (!header) return false;
  if (header.length !== `Bearer ${cronSecret}`.length) return false;
  let mismatch = 0;
  const expected = `Bearer ${cronSecret}`;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= (header.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

async function collect() {
  if (!isTelemetryConfigured()) {
    return NextResponse.json({ error: "Supabase telemetry is not configured." }, { status: 503 });
  }
  if (!process.env.CRON_SECRET?.trim()) {
    return NextResponse.json({ error: "Background collection is not configured." }, { status: 503 });
  }
  const supabase = createAdminClient();
  try {
    const outcome = await refreshProviderSnapshot(supabase, Date.now(), {
      apiKey: getOpenCodeGoApiKey() ?? "",
    });
    if (!outcome.ok) {
      // Report a generic unavailable state without leaking provider internals.
      return NextResponse.json({ collected: false, stored: false }, { status: 200 });
    }
    return NextResponse.json({ collected: true, stored: outcome.stored }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Collection failed." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  return collect();
}

export async function POST(request: Request) {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  return collect();
}
