"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Auto-refresh on /opencode-go when the latest snapshot is >=2min old.
 * Fires once per mount, server-computes everything, then revalidates.
 * Silent on failure: the stale snapshot stays visible.
 */
export function AutoRefresh({ latestObservedAtMs }: { latestObservedAtMs: number | null }) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    const age = latestObservedAtMs == null ? Number.POSITIVE_INFINITY : Date.now() - latestObservedAtMs;
    if (!(age >= 2 * 60 * 1000)) return;
    fired.current = true;
    void fetch("/api/opencode-go/refresh", { method: "POST" })
      .catch(() => null)
      .then(() => router.refresh());
  }, [latestObservedAtMs, router]);

  return null;
}
