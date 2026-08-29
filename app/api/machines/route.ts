import { NextResponse } from "next/server";

import { hasAuthenticatedUser } from "@/lib/auth/require-user";
import { createAdminClient, isTelemetryConfigured } from "@/lib/supabase/admin";


export async function POST(request: Request) {
  if (!isTelemetryConfigured()) {
    return NextResponse.json({ error: "Supabase telemetry is not configured." }, { status: 503 });
  }
  if (!(await hasAuthenticatedUser())) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
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
  if (!name || name.length > 100) {
    return NextResponse.json({ error: "A valid machine name is required." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("machines")
    .insert({ id, name })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  return NextResponse.json({ machine: data }, { status: 201 });
}
