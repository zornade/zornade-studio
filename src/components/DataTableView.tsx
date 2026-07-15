import type { ColumnRole } from "../lib/mapping";
import { useI18n } from "../i18n/LanguageContext";

/**
 * Visual metadata for every column role badge shown in the Struttura table
 * preview. Includes the data roles from {@link ColumnRole} plus the three chart
 * axis roles (x/y/series), which the Struttura panel assigns from the Design
 * axes rather than from the dataset bindings.
 */
type BadgeRole = ColumnRole | "x" | "y" | "series";

export type { BadgeRole };

const ROLE_META: Record<BadgeRole, { label: string; cls: string }> = {
  "geo-key": { label: "geografia", cls: "bg-emerald-100 text-emerald-700" },
  lat: { label: "latitudine", cls: "bg-emerald-100 text-emerald-700" },
  lon: { label: "longitudine", cls: "bg-emerald-100 text-emerald-700" },
  time: { label: "tempo", cls: "bg-violet-100 text-violet-700" },
  category: { label: "categoria", cls: "bg-amber-100 text-amber-700" },
  value: { label: "valore", cls: "bg-sky-100 text-sky-700" },
  label: { label: "etichetta", cls: "bg-slate-200 text-slate-600" },
  numeric: { label: "numero", cls: "bg-slate-100 text-slate-500" },
  other: { label: "testo", cls: "bg-slate-100 text-slate-400" },
  x: { label: "asse X", cls: "bg-sky-100 text-sky-700" },
  y: { label: "asse Y", cls: "bg-sky-100 text-sky-700" },
  series: { label: "serie", cls: "bg-amber-100 text-amber-700" },
};

export interface DataTableViewProps {
  columns: string[];
  rows: Record<string, string>[];
  /** Max rows rendered (the rest are summarised). */
  maxRows?: number;
  /** Optional per-column role key → coloured badge under the header. */
  roles?: Record<string, BadgeRole>;
}

/**
 * Plain, scrollable HTML table of a dataset's columns/rows. Used both as the
 * "table" visualisation (ChartCanvas) and as the Struttura step preview, where
 * an optional `roles` map paints a coloured badge under each header so the
 * operator sees, at a glance, how every column is being used.
 */
export function DataTableView({
  columns,
  rows,
  maxRows = 500,
  roles,
}: DataTableViewProps) {
  const { dict } = useI18n();
  const shown = rows.slice(0, maxRows);
  return (
    <div className="h-full overflow-auto rounded-lg ring-1 ring-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-slate-50">
          <tr>
            {columns.map((c) => {
              const role = roles?.[c];
              const meta = role ? ROLE_META[role] : null;
              return (
                <th
                  key={c}
                  className="border-b border-slate-200 px-3 py-2 text-left align-top font-semibold text-slate-700"
                >
                  <div className="whitespace-nowrap">{c}</div>
                  {meta && (
                    <span
                      className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${meta.cls}`}
                    >
                      {meta.label}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} className="odd:bg-white even:bg-slate-50/60">
              {columns.map((c) => (
                <td
                  key={c}
                  className="border-b border-slate-100 px-3 py-1.5 text-slate-600"
                >
                  {row[c]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows && (
        <p className="px-3 py-2 text-[11px] text-slate-400">
          {dict.dataTableView.shownRows(maxRows, rows.length)}
        </p>
      )}
    </div>
  );
}
