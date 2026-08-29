"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton({
  compact = false,
}: {
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const logout = async () => {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/auth/login");
    router.refresh();
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size={compact ? "sm" : "default"}
      onClick={logout}
      disabled={busy}
      aria-label={compact ? "Sign out" : undefined}
      className="text-slate-400 hover:text-slate-100"
    >
      <LogOut className="h-4 w-4" />
      {compact ? "Sign out" : busy ? "Signing out..." : "Sign out"}
    </Button>
  );
}
