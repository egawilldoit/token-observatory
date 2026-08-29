import "server-only";

import { createClient } from "@/lib/supabase/server";

function allowedEmailSet() {
  return new Set(
    (process.env.TOKEN_OBSERVATORY_ALLOWED_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isObservatoryAccessConfigured() {
  return allowedEmailSet().size > 0;
}

export async function getObservatoryAccess() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return { authenticated: false, authorized: false, email: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims as Record<string, unknown> | undefined;
  const email =
    typeof claims?.email === "string" ? claims.email.trim().toLowerCase() : null;

  if (error || !claims || !email) {
    return { authenticated: false, authorized: false, email };
  }

  return {
    authenticated: true,
    authorized: allowedEmailSet().has(email),
    email,
  };
}

export async function hasAuthenticatedUser() {
  return (await getObservatoryAccess()).authenticated;
}

export async function hasObservatoryAccess() {
  return (await getObservatoryAccess()).authorized;
}
