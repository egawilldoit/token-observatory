import type { OpenCodeGoFreshness, OpenCodeGoV2Status } from "@/lib/opencode-go/comparison";

const STATUS_META: Record<
  OpenCodeGoV2Status,
  { label: string; badge: string; dot: string; icon: string; description: string }
> = {
  ON_TRACK: {
    label: "On track",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
    icon: "●",
    description: "Current usage is more than 2 percentage points below your safe ceiling.",
  },
  NEAR_PLAN: {
    label: "Near plan",
    badge: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
    icon: "◐",
    description: "Current usage is within 2 percentage points of your safe ceiling. Ease off to stay safe.",
  },
  OVER_PACE: {
    label: "Over pace",
    badge: "border-orange-200 bg-orange-50 text-orange-800",
    dot: "bg-orange-500",
    icon: "▲",
    description: "Current usage is above your safe ceiling. Reduce usage to return to plan.",
  },
  LIMIT_EXCEEDED: {
    label: "Limit exceeded",
    badge: "border-red-200 bg-red-50 text-red-800",
    dot: "bg-red-500",
    icon: "■",
    description: "Monthly usage reached 100% or OpenCode is rate limiting. Usage is blocked until reset.",
  },
  SYNC_STALE: {
    label: "Sync stale",
    badge: "border-slate-300 bg-slate-100 text-slate-700",
    dot: "bg-slate-500",
    icon: "○",
    description: "No recent provider reading. Refresh to compare against your safe plan.",
  },
  RESET_REQUIRED: {
    label: "Reset required",
    badge: "border-slate-300 bg-slate-100 text-slate-700",
    dot: "bg-slate-500",
    icon: "↻",
    description: "A new monthly cycle started. Upload a new Monthly Safe Plan to resume tracking.",
  },
};

export function v2StatusLabel(status: OpenCodeGoV2Status): string {
  return STATUS_META[status].label.toUpperCase();
}

const FRESHNESS_META: Record<OpenCodeGoFreshness, { label: string; dot: string }> = {
  LIVE: { label: "LIVE", dot: "bg-emerald-500" },
  RECENT: { label: "RECENT", dot: "bg-amber-500" },
  STALE: { label: "STALE", dot: "bg-slate-400" },
};

export function TrackerStatus({
  status,
  freshness,
  syncedAgo,
  checkTime,
}: {
  status: OpenCodeGoV2Status;
  freshness: OpenCodeGoFreshness;
  syncedAgo: string;
  checkTime: string;
}) {
  const meta = STATUS_META[status];
  const fresh = FRESHNESS_META[freshness];
  void checkTime;
  return (
    <section aria-label="OpenCode Go status" className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)]">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600"
          aria-label={`Freshness ${fresh.label}, ${syncedAgo}`}
        >
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${fresh.dot}`} />
          {fresh.label} · {syncedAgo}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${meta.badge}`}
        >
          <span aria-hidden="true">{meta.icon}</span>
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${meta.dot}`} />
          {meta.label.toUpperCase()}
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{meta.description}</p>
    </section>
  );
}
