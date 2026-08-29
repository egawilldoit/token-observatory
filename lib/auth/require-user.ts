import "server-only";

import { createClient } from "@/lib/supabase/server";

export async function hasAuthenticatedUser() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ) {
    return false;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  return !error && Boolean(data?.claims);
}
