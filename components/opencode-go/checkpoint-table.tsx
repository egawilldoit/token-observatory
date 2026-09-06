import { formatPercent, formatPoints, formatWholePercent } from "@/lib/opencode-go/format";

export type V2CheckpointRow = {
  day: number;
  date: string;
  timestamp: string;
  ceiling: number;
  /** Real provider observation aligned to this checkpoint date, if any. */
  providerObservation: number | null;
  headroom: number | null;
  status: string;
  isCurrent: boolean;
  isFuture: boolean;
};

function badgeFor(status: string): string {
  switch (status) {
    case "Upcoming":
      return "border-slate-200 bg-slate-50 text-slate-500";
    case "On track":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "Near plan":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "Over pace":
      return "border-orange-200 bg-orange-50 text-orange-800";
    case "Limit exceeded":
      return "border-red-200 bg-red-50 text-red-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

/**
 * Checkpoint history (V2).
 * - Future rows are upcoming, never rendered as a missing-data state.
 * - The current row is strongly highlighted; future rows are subdued.
 * - Past rows without provider history show "—" (history is never invented).
 * - Mobile renders cards; desktop renders a table.
 */
export function CheckpointTable({ checkpoints }: { checkpoints: V2CheckpointRow[] }) {
  return (
    <section
      aria-label="Checkpoint history"
      className="mt-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)]"
    >
      <h2 className="font-semibold text-slate-950">Checkpoint history</h2>
      <p className="mt-1 text-xs text-slate-500">
        Safe ceiling from your Monthly Safe Plan against real OpenCode usage. Future checkpoints are
        upcoming, not missing.
      </p>

      <div className="mt-4 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th scope="col" className="pb-3 font-medium">Checkpoint</th>
              <th scope="col" className="pb-3 font-medium">Safe ceiling</th>
              <th scope="col" className="pb-3 font-medium">Provider observation</th>
              <th scope="col" className="pb-3 font-medium">Headroom</th>
              <th scope="col" className="pb-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {checkpoints.map((row) => (
              <tr
                key={row.date}
                aria-current={row.isCurrent ? "true" : undefined}
                className={
                  row.isCurrent
                    ? "bg-blue-50/60 font-medium text-slate-900 outline outline-1 outline-blue-200"
                    : row.isFuture
                      ? "text-slate-400"
                      : "text-slate-600"
                }
              >
                <td className="py-2.5 pr-4">
                  <span className="font-medium text-slate-800">{row.date}</span>
                  {row.isCurrent ? (
                    <span className="ml-2 rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                      current
                    </span>
                  ) : null}
                </td>
                <td className="py-2.5 pr-4">{formatPercent(row.ceiling)}</td>
                <td className="py-2.5 pr-4">
                  {row.providerObservation == null ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    formatWholePercent(row.providerObservation)
                  )}
                </td>
                <td className="py-2.5 pr-4">
                  {row.headroom == null ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    formatPoints(row.headroom)
                  )}
                </td>
                <td className="py-2.5">
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${badgeFor(row.status)}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="mt-4 space-y-2 md:hidden">
        {checkpoints.map((row) => (
          <li
            key={row.date}
            aria-current={row.isCurrent ? "true" : undefined}
            className={`rounded-xl border p-3 text-xs ${
              row.isCurrent
                ? "border-blue-300 bg-blue-50/70 text-slate-900"
                : row.isFuture
                  ? "border-slate-100 bg-slate-50/50 text-slate-400"
                  : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-slate-800">
                {row.date}
                {row.isCurrent ? <span className="ml-2 text-[10px] font-semibold text-blue-700">current</span> : null}
              </p>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badgeFor(row.status)}`}>
                {row.status}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-400">Safe ceiling</dt>
                <dd className="mt-0.5 font-medium">{formatPercent(row.ceiling)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-400">Provider</dt>
                <dd className="mt-0.5 font-medium">
                  {row.providerObservation == null ? "—" : formatWholePercent(row.providerObservation)}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-slate-400">Headroom</dt>
                <dd className="mt-0.5 font-medium">
                  {row.headroom == null ? "—" : formatPoints(row.headroom)}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
