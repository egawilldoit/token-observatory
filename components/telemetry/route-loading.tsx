export function TelemetryRouteLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-4"
    >
      <div className="h-4 w-28 animate-pulse rounded bg-white/[0.06]" />
      <div className="h-10 w-full max-w-xl animate-pulse rounded-xl bg-white/[0.06]" />
      <div className="h-4 w-full max-w-2xl animate-pulse rounded bg-white/[0.04]" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-2xl border border-white/10 bg-white/[0.035]"
          />
        ))}
      </div>
      <span className="sr-only">Loading telemetry…</span>
    </div>
  );
}
