/**
 * Excel (.xlsx/.xls) → tabular { columns, rows } (ROADMAP O2.3).
 *
 * SheetJS is **vendored** (`src/vendor/sheetjs/xlsx.mjs`, official CDN 0.20.3,
 * Apache-2.0) and **lazy-loaded** here, so the ~1 MB library never enters the
 * initial editor bundle and never ships in the published embed (the embed only
 * consumes the spec). We read the first sheet and emit the same shape as
 * `parseCsv`: the first row is the header, every cell is a trimmed string.
 *
 * `raw: false` makes SheetJS format numbers/dates to their displayed text, so
 * downstream Italian-aware parsing (`parseNumber`) sees the same strings a user
 * sees in Excel; `defval: ""` fills blank cells so rows stay rectangular.
 */

import type { ParsedCsv } from "../csv";

export interface ExcelParseResult extends ParsedCsv {
  /** Name of the sheet that was read. */
  sheetName: string;
  /** Names of all sheets in the workbook (the first one is used). */
  sheetNames: string[];
}

/** Parse the first sheet of an Excel workbook into { columns, rows }. */
export async function parseExcel(
  data: ArrayBuffer | Uint8Array,
): Promise<ExcelParseResult> {
  // Lazy import keeps SheetJS out of the initial bundle (Vite emits a chunk).
  const XLSX = await import("../../vendor/sheetjs/xlsx.mjs");
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const wb = XLSX.read(bytes, { type: "array" });

  const sheetNames = wb.SheetNames ?? [];
  if (sheetNames.length === 0) {
    return { columns: [], rows: [], sheetName: "", sheetNames: [] };
  }
  const sheetName = sheetNames[0];
  const sheet = wb.Sheets[sheetName];

  // header: 1 → array-of-arrays; raw: false → formatted text; defval: "" → no holes.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  if (matrix.length === 0) {
    return { columns: [], rows: [], sheetName, sheetNames };
  }

  const header = (matrix[0] ?? []).map((c) => String(c ?? "").trim());
  const columns = dedupeHeader(header);

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? [];
    const row: Record<string, string> = {};
    columns.forEach((col, idx) => {
      row[col] = String(cells[idx] ?? "").trim();
    });
    // Skip fully empty rows (footnotes/spacers common in PA spreadsheets).
    if (Object.values(row).some((v) => v !== "")) rows.push(row);
  }

  return { columns, rows, sheetName, sheetNames };
}

/**
 * Ensure column names are unique and non-empty: blank headers become "Colonna
 * N" and duplicates get a numeric suffix, so they can key a row object safely.
 */
function dedupeHeader(header: string[]): string[] {
  const seen = new Map<string, number>();
  return header.map((raw, idx) => {
    let name = raw || `Colonna ${idx + 1}`;
    if (seen.has(name)) {
      const n = seen.get(name)! + 1;
      seen.set(name, n);
      name = `${name} (${n})`;
    } else {
      seen.set(name, 1);
    }
    return name;
  });
}
