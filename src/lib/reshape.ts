/**
 * Wide → long reshaping (a.k.a. "melt"/"unpivot"), ROADMAP §1.12.3.
 *
 * Many published tables are *wide*: one column per period (e.g. `2019, 2020,
 * 2021`). Time-based charts and the time-slider want *long/tidy* data: one row
 * per (entity, period) with a single value column. This module detects the
 * wide shape (≥2 columns whose **header** is a period) and pivots it.
 */

import type { ParsedCsv } from "./csv";
import { parsePeriod } from "./profile";

export interface MeltCandidate {
  /** Columns kept as identifiers (non-period). */
  idColumns: string[];
  /** Columns whose header is a period, to be unpivoted. */
  periodColumns: string[];
}

/**
 * Detect whether the table is wide (≥2 period-headed columns + ≥1 id column).
 * Returns the column split, or null if it does not look wide.
 */
export function detectWide(columns: string[]): MeltCandidate | null {
  const periodColumns = columns.filter((c) => parsePeriod(c) != null);
  const idColumns = columns.filter((c) => parsePeriod(c) == null);
  if (periodColumns.length >= 2 && idColumns.length >= 1) {
    return { idColumns, periodColumns };
  }
  return null;
}

export interface MeltOptions {
  /** Name of the new column holding the former period headers. */
  periodName?: string;
  /** Name of the new column holding the values. */
  valueName?: string;
}

/**
 * Pivot a wide table to long form. Each input row becomes one row per period
 * column: the id columns are copied, the period header goes into `periodName`,
 * and the cell value into `valueName`. Empty cells are skipped.
 */
export function meltWide(
  parsed: ParsedCsv,
  candidate: MeltCandidate,
  opts: MeltOptions = {},
): ParsedCsv {
  const periodName = opts.periodName ?? "periodo";
  const valueName = opts.valueName ?? "valore";
  const { idColumns, periodColumns } = candidate;

  const columns = [...idColumns, periodName, valueName];
  const rows: Record<string, string>[] = [];
  for (const row of parsed.rows) {
    for (const period of periodColumns) {
      const value = row[period];
      if (value == null || String(value).trim() === "") continue;
      const out: Record<string, string> = {};
      for (const id of idColumns) out[id] = row[id] ?? "";
      out[periodName] = period;
      out[valueName] = value;
      rows.push(out);
    }
  }
  return { columns, rows };
}
