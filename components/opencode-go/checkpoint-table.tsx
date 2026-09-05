import { formatPercent, formatPoints } from "@/lib/opencode-go/view-model";

export type CheckpointRow = {
  day: number;
  date: string;
  ceiling: number;
  actual: number | null;
};

function rowStatus(row: CheckpointRow): string {
  if (row.actual == null) return "Missing";
  if (row.actual > row.ceiling) return "Over pace";
  if (row.ceiling - row.actual <= 0.02) return "Near limit";
  return "On track";
}

export function CheckpointTable({
  checkpoints,
  requiredDate,
  updateDue,
}: {
  checkpoints: CheckpointRow[];
  requiredDate: string | null;
  updateDue: boolean;
}) {
  return (
    <section
      aria-label="Checkpoint history"
      className="mt-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)]"
    >
      <h2 className="font-semibold text-slate-950">Checkpoint history</h2>
      <p className="mt-1 text-xs text-slate-500">
        Planned ceiling versus recorded usage for every daily checkpoint.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th scope="col" className="pb-3 font-medium">Date</th>
              <th scope="col" className="pb-3 font-medium">Ceiling</th>
              <th scope="col" className="pb-3 font-medium">Actual</th>
              <th scope="col" className="pb-3 font-medium">Status</th>
              <th scope="col" className="pb-3 font-medium">Headroom</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {checkpoints.map((row) => {
              const isRequired = updateDue && row.date === requiredDate;
              return (
                <tr key={row.date} className="text-slate-500">
                  <td className="py-2.5 pr-4 font-medium text-slate-700">
                    {row.date}
                    {isRequired ? (
                      <span className="ml-2 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-800">
                        update due
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-4">{formatPercent(row.ceiling)}</td>
                  <td className="py-2.5 pr-4">
                    {row.actual == null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      formatPercent(row.actual)
                    )}
                  </td>
                  <td className="py-2.5 pr-4">{rowStatus(row)}</td>
                  <td className="py-2.5">
                    {row.actual == null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      formatPoints(row.ceiling - row.actual)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
