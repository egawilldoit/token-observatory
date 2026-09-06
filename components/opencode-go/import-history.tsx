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

/**
 * Import history (V2): compact and product-focused. Workbook uploads are the
 * Monthly Safe Plan, secondary to the daily comparison. Technical details
 * (duplicate targets, formula warnings, ids) live in an expandable section.
 */
export function ImportHistory({ rows }: { rows: OpenCodeGoHistoryRow[] }) {
  const visible = rows.slice(0, 5);
  return (
    <section
      aria-label="Import history"
      className="mt-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)]"
    >
      <h2 className="font-semibold text-slate-950">Import history</h2>
      <p className="mt-1 text-xs text-slate-500">
        Monthly Safe Plan uploads. Your plan only changes when you replace it.
      </p>
      {visible.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No safe plan uploads yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 text-xs">
          {visible.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{row.filename ?? "—"}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {shortTime(row.created_at)} ·{" "}
                  {row.tracking_start && row.reset_at
                    ? `${shortDate(row.tracking_start)} → ${shortDate(row.reset_at)}`
                    : "—"}
                </p>
              </div>
              <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-600">
                {row.status}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 ? (
        <details className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">
            Technical details ({rows.length})
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[11px]">
              <thead className="text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th scope="col" className="pb-2 font-medium">Imported</th>
                  <th scope="col" className="pb-2 font-medium">Status</th>
                  <th scope="col" className="pb-2 font-medium">Duplicate of</th>
                  <th scope="col" className="pb-2 font-medium">Formulas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="py-1.5 pr-3">{shortTime(row.created_at)}</td>
                    <td className="py-1.5 pr-3">{row.status}</td>
                    <td className="py-1.5 pr-3">
                      {row.duplicate_of_import_id ? row.duplicate_of_import_id.slice(0, 8) : "—"}
                    </td>
                    <td className="py-1.5">
                      {(row.formula_mismatch_count ?? 0) > 0
                        ? `${row.formula_mismatch_count} warnings`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
