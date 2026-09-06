import { NextResponse } from "next/server";

import { getObservatoryAccess } from "@/lib/auth/require-user";
import { V2_REFRESH_COOLDOWN_MS } from "@/lib/opencode-go/comparison";
import { providerErrorMessage } from "@/lib/opencode-go/provider-schema";
import { getLatestProviderSnapshot, listProviderSnapshots } from "@/lib/opencode-go/provider-queries";
import { getActiveOpenCodeGoSnapshot } from "@/lib/opencode-go/queries";
import { refreshProviderSnapshot } from "@/lib/opencode-go/refresh";
import type { StoredSnapshot } from "@/lib/opencode-go/snapshot";
import { buildV2View } from "@/lib/opencode-go/v2-view";
import { isCrossOriginRequest } from "@/lib/http/request";
import { createAdminClient, isTelemetryConfigured } from "@/lib/supabase/admin";

async function currentView(supabase: ReturnType<typeof createAdminClient>, nowMs: number) {
  const [active, providerSnapshots] = await Promise.all([
    getActiveOpenCodeGoSnapshot(supabase),
    listProviderSnapshots(supabase, 60),
  ]);
  return buildV2View({
    contractSnapshot: (active?.parsed_snapshot as StoredSnapshot | null) ?? null,
    contractMeta: active
      ? {
          filename: active.filename,
          importedAt: active.created_at,
          trackingStartIso: active.tracking_start as string,
          resetAtIso: active.reset_at as string,
          checkTime: (active.check_time as string) ?? "12:00",
          baseline: Number(active.baseline_usage),
          hardLimit: Number(active.hard_limit),
          safetyReserve: Number(active.safety_reserve),
          plannedCeiling: Number(active.planned_ceiling),
        }
      : null,
    providerSnapshotsNewestFirst: providerSnapshots,
    nowMs,
  });
}

/**
 * V2 manual refresh (server-side live fetch).
 * - Auth + allowlist + same-origin required.
 * - Backend cooldown ~45s: recent snapshots return 429 with cached state.
 * - On provider failure the last successful snapshot is preserved and
 *   returned with a sanitized message (no secret, no upstream body).
 */
export async function POST(request: Request) {
  if (!isTelemetryConfigured()) {
    return NextResponse.json({ error: "Supabase telemetry is not configured." }, { status: 503 });
  }
  const access = await getObservatoryAccess();
  if (!access.authenticated) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!access.authorized) {
    return NextResponse.json({ error: "Observatory access denied." }, { status: 403 });
  }
  if (isCrossOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin mutations are not allowed." }, { status: 403 });
  }

  const supabase = createAdminClient();
  const nowMs = Date.now();

  let latest: Awaited<ReturnType<typeof getLatestProviderSnapshot>>;
  try {
    latest = await getLatestProviderSnapshot(supabase);
  } catch {
    return NextResponse.json({ error: "Could not read provider observations." }, { status: 500 });
  }

  if (latest) {
    const ageMs = nowMs - Date.parse(latest.observed_at);
    if (ageMs < V2_REFRESH_COOLDOWN_MS) {
      const view = await currentView(supabase, nowMs);
      const retryAfterSeconds = Math.max(1, Math.ceil((V2_REFRESH_COOLDOWN_MS - ageMs) / 1000));
      return NextResponse.json(
        {
          refreshed: false,
          cooldown: true,
          retryAfterSeconds,
          message: `Refresh is cooling down. Try again in ${retryAfterSeconds}s.`,
          nowIso: view.nowIso,
          hasContract: view.hasContract,
          contractMeta: view.contractMeta,
          comparison: view.comparison,
          providerSnapshot: view.providerSnapshot,
        },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
      );
    }
  }

  let outcome: Awaited<ReturnType<typeof refreshProviderSnapshot>>;
  try {
    outcome = await refreshProviderSnapshot(supabase, nowMs);
  } catch {
    const view = await currentView(supabase, Date.now());
    return NextResponse.json(
      {
        refreshed: false,
        providerUnavailable: true,
        message: "Live usage is temporarily unavailable. Showing the last synced reading.",
        nowIso: view.nowIso,
        hasContract: view.hasContract,
        contractMeta: view.contractMeta,
        comparison: view.comparison,
        providerSnapshot: view.providerSnapshot,
      },
      { status: 200 },
    );
  }

  if (!outcome.ok) {
    const view = await currentView(supabase, Date.now());
    if (!view.providerSnapshot) {
      const status = outcome.code === "not_configured" ? 503 : 502;
      return NextResponse.json(
        { error: providerErrorMessage(outcome), hasContract: view.hasContract },
        { status },
      );
    }
    return NextResponse.json(
      {
        refreshed: false,
        providerUnavailable: true,
        message: providerErrorMessage(outcome),
        nowIso: view.nowIso,
        hasContract: view.hasContract,
        contractMeta: view.contractMeta,
        comparison: view.comparison,
        providerSnapshot: view.providerSnapshot,
      },
      { status: 200 },
    );
  }

  const view = await currentView(supabase, Date.now());
  return NextResponse.json({
    refreshed: true,
    stored: outcome.stored,
    nowIso: view.nowIso,
    hasContract: view.hasContract,
    contractMeta: view.contractMeta,
    comparison: view.comparison,
    providerSnapshot: view.providerSnapshot,
  });
}
