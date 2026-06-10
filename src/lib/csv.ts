/**
 * Minimal dependency-free CSV parser.
 *
 * Handles the common cases produced by spreadsheets: comma or semicolon
 * delimiters, quoted fields, escaped quotes ("") and CRLF/LF line endings.
 * It is intentionally small — not a full RFC-4180 implementation — and is
 * sufficient for the tabular data newsrooms paste or upload.
 */

export interface ParsedCsv {
  columns: string[];
  rows: Record<string, string>[];
}

/** Detect the most likely delimiter by counting occurrences on the header. */
function detectDelimiter(headerLine: string): string {
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    const count = headerLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** Split a single CSV line honouring quotes. */
function splitLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

export function parseCsv(text: string): ParsedCsv {
  // Strip a UTF-8 BOM if present and normalise line endings.
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = clean.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { columns: [], rows: [] };

  const delimiter = detectDelimiter(lines[0]);
  const columns = splitLine(lines[0], delimiter).map((c) => c.trim());

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i], delimiter);
    const row: Record<string, string> = {};
    columns.forEach((col, idx) => {
      row[col] = (cells[idx] ?? "").trim();
    });
    rows.push(row);
  }

  return { columns, rows };
}

/** Parse a numeric cell, tolerating Italian decimals ("12,19") and "%". */
export function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim().replace(/%/g, "").replace(/\s/g, "");
  if (s === "") return null;
  // If both separators present, assume "." thousands + "," decimals.
  let normalised = s;
  if (s.includes(",") && s.includes(".")) {
    normalised = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    normalised = s.replace(",", ".");
  }
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}

/** Return the columns that look numeric (majority of non-empty cells parse). */
export function detectNumericColumns(
  columns: string[],
  rows: Record<string, string>[],
): string[] {
  return columns.filter((col) => {
    let total = 0;
    let numeric = 0;
    for (const row of rows) {
      const v = row[col];
      if (v == null || v.trim() === "") continue;
      total++;
      if (parseNumber(v) != null) numeric++;
    }
    return total > 0 && numeric / total >= 0.6;
  });
}
