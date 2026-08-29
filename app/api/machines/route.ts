import { NextResponse } from "next/server";

import { getObservatoryAccess } from "@/lib/auth/require-user";
import { isCrossOriginRequest } from "@/lib/http/request";
import { createAdminClient, isTelemetryConfigured } from "@/lib/supabase/admin";

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

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim().toLowerCase() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";

  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) {
    return NextResponse.json(
      { error: "Machine ID must be 2-64 lowercase letters, numbers or hyphens." },
      { status: 400 },
    );
  }

  if (
    !name ||
    name.length > 100 ||
    /[\u0000-\u001f\u007f]/.test(name)
  ) {
    return NextResponse.json(
      { error: "A valid machine name is required." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("machines")
    .insert({ id, name })
    .select("*")
    .single();

  if (error?.code === "23505") {
    return NextResponse.json(
      { error: "That machine ID or display name is already registered." },
      { status: 409 },
    );
  }

  if (error) {
    return NextResponse.json(
      { error: "Could not register the machine." },
      { status: 500 },
    );
  }

  return NextResponse.json({ machine: data }, { status: 201 });
}
