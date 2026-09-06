"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type RefreshResponse = {
  refreshed?: boolean;
  cooldown?: boolean;
  retryAfterSeconds?: number;
  message?: string;
  error?: string;
};

/**
 * Manual "Refresh usage" (V2). Keyboard-accessible button that triggers a
 * server-side live fetch. Domain math stays server-side; this only displays
 * the server result and reloads.
 */
export function RefreshButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function onRefresh() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/opencode-go/refresh", { method: "POST" });
      const body = (await res.json().catch(() => null)) as RefreshResponse | null;
      if (res.status === 429) {
        setNotice(body?.message ?? "Refresh is cooling down. Try again shortly.");
      } else if (!res.ok && res.status !== 200) {
        setNotice(body?.error ?? body?.message ?? "Refresh failed. Try again.");
      }
      router.refresh();
    } catch {
      setNotice("You appear to be offline. Showing the last synced reading.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void onRefresh()}
        disabled={busy || disabled}
        aria-live="polite"
        className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Refreshing…" : "Refresh usage"}
      </button>
      {notice ? (
        <p role="status" className="max-w-[220px] text-right text-[11px] text-slate-500">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
