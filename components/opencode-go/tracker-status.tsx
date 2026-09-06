import type { OpenCodeGoV2Status } from "@/lib/opencode-go/comparison";

const STATUS_META: Record<
  OpenCodeGoV2Status,
  { label: string; chip: string; dot: string; icon: string }
> = {
  ON_TRACK: {
    label: "On track",
    chip: "border-emerald-300 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
    icon: "●",
  },
  NEAR_PLAN: {
    label: "Near plan",
    chip: "border-amber-300 bg-amber-50 text-amber-900",
    dot: "bg-amber-500",
    icon: "◐",
  },
  OVER_PACE: {
    label: "Over pace",
    chip: "border-red-300 bg-red-50 text-red-800",
    dot: "bg-red-500",
    icon: "▲",
  },
  LIMIT_EXCEEDED: {
    label: "Limit exceeded",
    chip: "border-red-400 bg-red-600 text-white",
    dot: "bg-white",
    icon: "■",
  },
  SYNC_STALE: {
    label: "Sync stale",
    chip: "border-slate-300 bg-slate-100 text-slate-700",
    dot: "bg-slate-500",
    icon: "○",
  },
  RESET_REQUIRED: {
    label: "Reset required",
    chip: "border-slate-400 bg-slate-800 text-white",
    dot: "bg-white",
    icon: "↻",
  },
};

export function v2StatusLabel(status: OpenCodeGoV2Status): string {
  return STATUS_META[status].label.toUpperCase();
}

/**
 * Compact Ledger status chip. Text + icon + tone (never color alone).
 * Freshness is shown exactly once in the console header, never here.
 */
export function TrackerStatus({ status }: { status: OpenCodeGoV2Status }) {
  const meta = STATUS_META[status];
  return (
    <span
      role="status"
      aria-label={`Status: ${meta.label}`}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-bold tracking-wide ${meta.chip}`}
    >
      <span aria-hidden="true">{meta.icon}</span>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label.toUpperCase()}
    </span>
  );
}
