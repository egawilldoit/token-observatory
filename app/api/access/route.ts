import { NextResponse } from "next/server";

import { getObservatoryAccess } from "@/lib/auth/require-user";
import { isTelemetryConfigured } from "@/lib/supabase/admin";

export async function GET() {
  if (!isTelemetryConfigured()) {
    return NextResponse.json(
      { error: "Token Observatory is not fully configured." },
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

  return NextResponse.json({ authorized: true, email: access.email });
}
