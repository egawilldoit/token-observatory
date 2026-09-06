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

function statusLabel(status: string): string {
  switch (status) {
    case "processed":
      return "Processed";
    case "exact_duplicate":
      return "Exact duplicate";
    case "superseded":
      return "Superseded";
    case "corrected":
      return "Corrected";
    default:
      return status;
  }
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
      className="mt-3 rounded-xl border border-slate-200/90 bg-white px-4 py-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <h2 className="text-sm font-semibold text-slate-950">Import history</h2>
      {visible.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No safe plan uploads yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-slate-100 text-xs">
          {visible.map((row) => (
            <li key={row.id} className="flex items-baseline justify-between gap-3 py-1.5">
              <p className="min-w-0 truncate text-slate-700">
                {shortDate(row.created_at)} ·{" "}
                <span className="font-medium text-slate-900">{row.filename ?? "—"}</span>
              </p>
              <span className="shrink-0 text-slate-500">{statusLabel(row.status)}</span>
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
