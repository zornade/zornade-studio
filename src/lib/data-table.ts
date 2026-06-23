/**
 * Data-table helpers (O3.5) — pure, dependency-free, testable.
 *
 * Two outputs share one source so the editor download and the published embed
 * stay consistent:
 *  - `rowsToCsv` — an RFC-4180 CSV string of the dataset for the in-editor
 *    "Scarica CSV" download (accessible, machine-readable raw data).
 *  - `accessibleTableHtml` — a semantic `<table>` (caption + `<th scope>`),
 *    inlined **visually-hidden** in the embed so screen readers can read the
 *    underlying data of an otherwise canvas-only (WebGL) map.
 *
 * All user-controlled strings are escaped for the HTML output; the CSV quotes
 * fields per RFC 4180 (double-quote wrapping, doubled inner quotes).
 */

/** Escape a string for safe inclusion in HTML text/attribute context. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Quote a single CSV field per RFC 4180 when it contains a delimiter, quote,
 * or newline; inner quotes are doubled. */
function csvField(value: string): string {
  const s = value ?? "";
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Serialise tabular data to an RFC-4180 CSV string. Rows are emitted in column
 * order; missing cells become empty fields. A leading UTF-8 BOM is added so
 * spreadsheet apps (Excel) open it as UTF-8 by default.
 */
export function rowsToCsv(
  columns: string[],
  rows: Record<string, string>[],
  opts: { bom?: boolean } = {},
): string {
  const header = columns.map(csvField).join(",");
  const body = rows
    .map((row) => columns.map((c) => csvField(String(row[c] ?? ""))).join(","))
    .join("\r\n");
  const csv = rows.length > 0 ? `${header}\r\n${body}` : header;
  return opts.bom === false ? csv : `\uFEFF${csv}`;
}

/**
 * Build a semantic HTML `<table>` from tabular data. The first column is marked
 * as a row header (`<th scope="row">`) so screen readers announce each row by
 * its label. A `<caption>` describes the table. Up to `maxRows` rows are
 * emitted (a published map can carry thousands of areas; the table stays a
 * reasonable size while remaining the accessible representation of the data).
 */
export function accessibleTableHtml(
  columns: string[],
  rows: Record<string, string>[],
  opts: { caption?: string; maxRows?: number } = {},
): string {
  const maxRows = opts.maxRows ?? 2000;
  const shown = rows.slice(0, maxRows);
  const caption = opts.caption
    ? `<caption>${escapeHtml(opts.caption)}</caption>`
    : "";
  const head = `<thead><tr>${columns
    .map((c) => `<th scope="col">${escapeHtml(c)}</th>`)
    .join("")}</tr></thead>`;
  const body = `<tbody>${shown
    .map((row) => {
      const cells = columns.map((c, i) => {
        const v = escapeHtml(String(row[c] ?? ""));
        return i === 0 ? `<th scope="row">${v}</th>` : `<td>${v}</td>`;
      });
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("")}</tbody>`;
  return `<table>${caption}${head}${body}</table>`;
}
