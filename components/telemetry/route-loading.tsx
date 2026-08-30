export function TelemetryRouteLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <div className="h-3 w-28 animate-pulse rounded-full bg-slate-200/80" />
      <div className="h-9 w-full max-w-xl animate-pulse rounded-xl bg-slate-200/70" />
      <div className="h-4 w-full max-w-2xl animate-pulse rounded-full bg-slate-100" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.02)]"
          />
        ))}
      </div>
      <span className="sr-only">Loading telemetry…</span>
    </div>
  );
}
