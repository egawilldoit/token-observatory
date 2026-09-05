export type OpenCodeGoHistoryRow = {
  id: string;
  status: string;
  filename: string | null;
  tracking_start: string | null;
  reset_at: string | null;
  latest_actual_usage: number | null;
  latest_actual_date: string | null;
  formula_mismatch_count: number | null;
  duplicate_of_import_id: string | null;
  created_at: string;
};

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Casablanca",
    month: "short",
    day: "2-digit",
  }).format(new Date(iso));
}

function shortTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Casablanca",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function ImportHistory({ rows }: { rows: OpenCodeGoHistoryRow[] }) {
  return (
    <section
      aria-label="OpenCode Go import history"
      className="mt-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)]"
    >
      <h2 className="font-semibold text-slate-950">Import history</h2>
      <p className="mt-1 text-xs text-slate-500">
        OpenCode Go uploads only — separate from ccusage imports. Accepted
        snapshots are immutable; corrections arrive as newer uploads.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th scope="col" className="pb-3 font-medium">Imported</th>
              <th scope="col" className="pb-3 font-medium">File</th>
              <th scope="col" className="pb-3 font-medium">Cycle</th>
              <th scope="col" className="pb-3 font-medium">Status</th>
              <th scope="col" className="pb-3 font-medium">Last recorded</th>
              <th scope="col" className="pb-3 font-medium">Formulas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} className="text-slate-500">
                <td className="py-2.5 pr-4">{shortTime(row.created_at)}</td>
                <td className="py-2.5 pr-4 font-medium text-slate-700">
                  {row.filename ?? "—"}
                </td>
                <td className="py-2.5 pr-4">
                  {row.tracking_start && row.reset_at
                    ? `${shortDate(row.tracking_start)} → ${shortDate(row.reset_at)}`
                    : "—"}
                </td>
                <td className="py-2.5 pr-4">
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-700">
                    {row.status}
                  </span>
                  {row.duplicate_of_import_id ? (
                    <span className="ml-1 text-[10px] text-slate-400">
                      dup of {row.duplicate_of_import_id.slice(0, 8)}
                    </span>
                  ) : null}
                </td>
                <td className="py-2.5 pr-4">
                  {row.latest_actual_usage == null
                    ? "—"
                    : `${(row.latest_actual_usage * 100).toFixed(1)}%${
                        row.latest_actual_date ? ` · ${row.latest_actual_date}` : ""
                      }`}
                </td>
                <td className="py-2.5">
                  {(row.formula_mismatch_count ?? 0) > 0
                    ? `${row.formula_mismatch_count} warning${row.formula_mismatch_count === 1 ? "" : "s"}`
                    : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">
                  No OpenCode Go imports yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
