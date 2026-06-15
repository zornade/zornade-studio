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

/**
 * Detect the most likely delimiter from a sample of lines (not just the
 * header). For each candidate we split every sampled line honouring quotes and
 * pick the delimiter that yields >1 column on the header and the **most
 * consistent** field count across rows (lowest variance), breaking ties by the
 * higher average field count. This is far more robust than counting on the
 * header alone (e.g. a header with a comma in a quoted label).
 */
function detectDelimiter(lines: string[]): string {
  const candidates = [",", ";", "\t", "|"];
  const sample = lines.slice(0, 50);
  let best = ",";
  let bestScore = -Infinity;
  for (const d of candidates) {
    const counts = sample.map((l) => splitLine(l, d).length);
    const headerFields = counts[0] ?? 1;
    if (headerFields < 2) continue;
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance =
      counts.reduce((a, b) => a + (b - mean) * (b - mean), 0) / counts.length;
    // Reward consistency (low variance) and more fields; penalise variance.
    const score = mean - variance * 5;
    if (score > bestScore) {
      bestScore = score;
      best = d;
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

  const delimiter = detectDelimiter(lines);
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

/** Parse a numeric cell, tolerating Italian formatting and noisy exports.
 *
 * Handles: Italian decimals ("12,19"), thousands grouping ("1.234,56",
 * "1.500" → 1500), percent and currency/units ("€ 1.500", "12,3 %", "850 kWh"),
 * negatives in parentheses ("(1.234)" → -1234), the Unicode minus (U+2212) and
 * non-breaking spaces. Explicit null tokens ("n.d.", "-", "N/A"…) and anything
 * that is not a number yield `null`.
 */
export function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (s === "") return null;

  // Accounting-style negative: a fully parenthesised value, e.g. "(1.234)".
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  // Normalise the Unicode minus to ASCII, then strip everything that is not a
  // digit, separator or sign (currency symbols, %, units like "kWh"/"€/m²",
  // spaces incl. NBSP, letters). This leaves only [0-9 , . -].
  s = s.replace(/\u2212/g, "-").replace(/[^\d.,-]/g, "");
  if (s === "" || s === "-") return null;

  let normalised: string;
  if (s.includes(",") && s.includes(".")) {
    // Both present → IT convention: "." thousands, "," decimals.
    normalised = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    // Only comma → decimal separator.
    normalised = s.replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    // Only dots, grouped as thousands ("1.500", "1.234.567") → drop them.
    normalised = s.replace(/\./g, "");
  } else {
    // Only dots, not a thousands pattern → treat dot as decimal ("12.5").
    normalised = s;
  }

  const n = Number(normalised);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
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
