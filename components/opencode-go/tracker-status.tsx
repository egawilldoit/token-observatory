import type { OpenCodeGoStatus } from "@/lib/opencode-go/types";

const STATUS_META: Record<
  OpenCodeGoStatus,
  { label: string; badge: string; dot: string }
> = {
  ON_TRACK: {
    label: "On track",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
  },
  NEAR_LIMIT: {
    label: "Near limit",
    badge: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  OVER_PACE: {
    label: "Over pace",
    badge: "border-orange-200 bg-orange-50 text-orange-800",
    dot: "bg-orange-500",
  },
  LIMIT_EXCEEDED: {
    label: "Limit exceeded",
    badge: "border-red-200 bg-red-50 text-red-800",
    dot: "bg-red-500",
  },
  UPDATE_DUE: {
    label: "Update due",
    badge: "border-sky-200 bg-sky-50 text-sky-800",
    dot: "bg-sky-500",
  },
  RESET_REQUIRED: {
    label: "Reset required",
    badge: "border-slate-300 bg-slate-100 text-slate-700",
    dot: "bg-slate-500",
  },
};

export function statusLabel(status: OpenCodeGoStatus): string {
  return STATUS_META[status].label.toUpperCase();
}

export function TrackerStatus({
  status,
  preFirstCheckpoint,
  requiredDate,
  checkTime,
}: {
  status: OpenCodeGoStatus;
  preFirstCheckpoint: boolean;
  requiredDate: string | null;
  checkTime: string;
}) {
  const meta = STATUS_META[status];
  const description =
    status === "RESET_REQUIRED"
      ? "This tracker belongs to the previous cycle."
      : status === "LIMIT_EXCEEDED"
        ? "Recorded usage reached the hard monthly limit."
        : status === "UPDATE_DUE"
          ? `Today's checkpoint was due at ${checkTime}. Last recorded usage is shown below.`
          : status === "OVER_PACE"
            ? "Recorded usage is above the planned ceiling."
            : status === "NEAR_LIMIT"
              ? "Recorded usage is within 2 percentage points of the planned ceiling."
              : preFirstCheckpoint
                ? "First checkpoint not due yet. Starting observation shown below."
                : "Recorded usage is below the planned ceiling.";
  const cta =
    status === "UPDATE_DUE"
      ? "Upload today's tracker"
      : status === "RESET_REQUIRED"
        ? "Upload the new cycle tracker"
        : null;

  return (
    <section aria-label="OpenCode Go status" className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)]">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
        Open Code Go
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold ${meta.badge}`}
        >
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${meta.dot}`} />
          {meta.label.toUpperCase()}
        </span>
        {preFirstCheckpoint && status === "ON_TRACK" ? (
          <span className="text-xs font-medium text-slate-500">
            First checkpoint not due yet
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
      {requiredDate && status === "UPDATE_DUE" ? (
        <p className="mt-1 text-xs text-slate-500">
          Missing checkpoint: {requiredDate} at {checkTime}
        </p>
      ) : null}
      {cta ? (
        <p className="mt-3 text-sm font-medium text-slate-900">{cta}</p>
      ) : null}
    </section>
  );
}