"use client";

import { useState } from "react";
import type { ReactNode } from "react";

/**
 * Reveal-on-demand wrapper for the plan replacement form. Replacing the
 * Monthly Safe Plan is rare, so the uploader stays hidden until asked for.
 */
export function ReplacePlan({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
      >
        {open ? "Hide replace form" : "Replace plan"}
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
