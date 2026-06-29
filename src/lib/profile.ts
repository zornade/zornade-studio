/**
 * Semantic column profiling - the data side of the "what did we understand?"
 * step (ROADMAP §1.12.2). For every column it assigns a *semantic type* with a
 * confidence score and basic statistics, so the viz-compatibility engine
 * (lib/viz-compat.ts) and the UI can decide which visualisations make sense.
 *
 * Geographic *area* keys (regione/provincia/comune/paese) are deliberately NOT
 * resolved here: they are matched against real geometry keys by value in
 * `resolveGeoJoin` (lib/choropleth.ts). This module covers the remaining
 * semantic types and detects geographic *points* (lat/lon) by name + range.
 *
 * All decision thresholds live in {@link THRESHOLDS} so they can be tuned and
 * tested in one place (calibrated against the golden fixtures, §1.13).
 */

import { parseNumber } from "./csv";

export type SemanticType =
  | "geo-point-lat"
  | "geo-point-lon"
  | "temporal"
  | "quantitative"
  | "categorical"
  | "identifier"
  | "text"
  | "empty";

/** Tunable thresholds (see ROADMAP §1.12.2). One place to calibrate. */
export const THRESHOLDS = {
  /** Min fraction of non-empty cells parseable as number → quantitative. */
  quantitative: 0.85,
  /** Min fraction of non-empty cells parseable as date/period → temporal. */
  temporal: 0.85,
  /** Min fraction of rows within lat/lon range → geo-point. */
  geoPoint: 0.95,
  /** Min distinct/non-empty ratio → identifier (quasi-unique). */
  identifier: 0.95,
  /** Categorical if distinct ≤ max(abs, frac × rows). */
  categoricalMaxDistinctAbs: 20,
  categoricalMaxDistinctFrac: 0.05,
  /** Score at/above which a detection is "high confidence" (auto-use). */
  highConfidence: 0.9,
  /** Max rows sampled when profiling. */
  sample: 2000,
} as const;

export interface ColumnStats {
  /** Total rows considered (after sampling). */
  total: number;
  /** Non-empty cells. */
  nonEmpty: number;
  /** Distinct non-empty values. */
  distinct: number;
  /** Fraction of empty cells (0..1). */
  emptyFrac: number;
  /** Fraction of non-empty cells parseable as number (0..1). */
  numericFrac: number;
  /** Fraction of non-empty cells parseable as date/period (0..1). */
  temporalFrac: number;
  /** Numeric min/max when quantitative. */
  min?: number;
  max?: number;
}

export interface ColumnProfile {
  name: string;
  type: SemanticType;
  /** Confidence 0..1 for the assigned type. */
  confidence: number;
  stats: ColumnStats;
  /** A few example values (for the "what we understood" panel). */
  examples: string[];
  /** Temporal granularity when type === "temporal". */
  temporalGranularity?: "year" | "semester" | "quarter" | "month" | "day";
}

const LAT_NAME = /^(lat|latitude|latitudine|coord_y)$/i;
const LON_NAME = /^(lon|lng|long|longitude|longitudine|coord_x)$/i;
const ID_NAME = /(^|_)(id|codice|code|istat|cod)(_|$)/i;
const MONTHS_IT =
  /^(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)[a-z]*\.?[-/ ]?\d{2,4}$/i;

/**
 * Detect a date / period cell and its granularity. Covers the Italian and ISO
 * formats common in PA exports (ROADMAP §1.12.3): dd/mm/yyyy, dd-mm-yyyy,
 * yyyy-mm-dd, yyyy, "2024 S1" / "I sem", "gen-2024", quarters.
 */
export function parsePeriod(
  raw: string | undefined,
): { granularity: ColumnProfile["temporalGranularity"] } | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "") return null;
  // ISO date yyyy-mm-dd (optionally with time).
  if (/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?/.test(s)) return { granularity: "day" };
  // dd/mm/yyyy or dd-mm-yyyy (also 2-digit year).
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s)) return { granularity: "day" };
  // yyyy/mm or yyyy-mm.
  if (/^\d{4}[/-]\d{1,2}$/.test(s)) return { granularity: "month" };
  // Year only (plausible range).
  if (/^\d{4}$/.test(s)) {
    const y = Number(s);
    if (y >= 1850 && y <= 2100) return { granularity: "year" };
    return null;
  }
  // Semester: "2024 S1", "2024S2", "2024 I sem", "I semestre 2024".
  if (/\b(19|20)\d{2}\b/.test(s) && /(\bS[12]\b|sem|semestre|\b(I{1,2})\b)/i.test(s))
    return { granularity: "semester" };
  // Quarter: "2024 Q3", "III trim", "trimestre".
  if (/\b(19|20)\d{2}\b/.test(s) && /(\bQ[1-4]\b|trim|trimestre)/i.test(s))
    return { granularity: "quarter" };
  // Month name + year (Italian abbreviations).
  if (MONTHS_IT.test(s)) return { granularity: "month" };
  return null;
}

function dominantGranularity(
  counts: Record<string, number>,
): ColumnProfile["temporalGranularity"] {
  let best: ColumnProfile["temporalGranularity"] = "day";
  let bestN = -1;
  for (const [g, n] of Object.entries(counts)) {
    if (n > bestN) {
      bestN = n;
      best = g as ColumnProfile["temporalGranularity"];
    }
  }
  return best;
}

/** Profile a single column from its raw cell values. */
export function profileColumn(name: string, values: string[]): ColumnProfile {
  const nonEmptyVals = values.filter((v) => v != null && String(v).trim() !== "");
  const total = values.length;
  const nonEmpty = nonEmptyVals.length;
  const distinctSet = new Set(nonEmptyVals.map((v) => v.trim()));
  const distinct = distinctSet.size;
  const examples = [...distinctSet].slice(0, 5);

  const baseStats: ColumnStats = {
    total,
    nonEmpty,
    distinct,
    emptyFrac: total === 0 ? 1 : (total - nonEmpty) / total,
    numericFrac: 0,
    temporalFrac: 0,
  };

  if (nonEmpty === 0) {
    return { name, type: "empty", confidence: 1, stats: baseStats, examples };
  }

  // Numeric & temporal fractions.
  let numeric = 0;
  let temporal = 0;
  let min = Infinity;
  let max = -Infinity;
  const granCounts: Record<string, number> = {};
  for (const v of nonEmptyVals) {
    const n = parseNumber(v);
    if (n != null) {
      numeric++;
      if (n < min) min = n;
      if (n > max) max = n;
    }
    const p = parsePeriod(v);
    if (p) {
      temporal++;
      granCounts[p.granularity ?? "day"] = (granCounts[p.granularity ?? "day"] ?? 0) + 1;
    }
  }
  const numericFrac = numeric / nonEmpty;
  const temporalFrac = temporal / nonEmpty;
  const distinctFrac = distinct / nonEmpty;
  const stats: ColumnStats = {
    ...baseStats,
    numericFrac,
    temporalFrac,
    ...(numeric > 0 ? { min, max } : {}),
  };

  // 1. Geo-point (lat/lon) by name + plausible coordinate range.
  if (LAT_NAME.test(name) && numericFrac >= THRESHOLDS.geoPoint) {
    const inRange =
      nonEmptyVals.filter((v) => {
        const n = parseNumber(v);
        return n != null && n >= -90 && n <= 90;
      }).length / nonEmpty;
    if (inRange >= THRESHOLDS.geoPoint) {
      return { name, type: "geo-point-lat", confidence: inRange, stats, examples };
    }
  }
  if (LON_NAME.test(name) && numericFrac >= THRESHOLDS.geoPoint) {
    const inRange =
      nonEmptyVals.filter((v) => {
        const n = parseNumber(v);
        return n != null && n >= -180 && n <= 180;
      }).length / nonEmpty;
    if (inRange >= THRESHOLDS.geoPoint) {
      return { name, type: "geo-point-lon", confidence: inRange, stats, examples };
    }
  }

  // 2. Temporal (prefer over quantitative: a year column is temporal, not a
  // quantity to colour). Require it not to be a wide numeric range.
  if (temporalFrac >= THRESHOLDS.temporal) {
    return {
      name,
      type: "temporal",
      confidence: temporalFrac,
      stats,
      examples,
      temporalGranularity: dominantGranularity(granCounts),
    };
  }

  // 3. Identifier by NAME (id/codice/istat…) + numeric codes. Caught before
  // quantitative so a code column is not mistaken for a measure to map.
  const looksLikeIdName = ID_NAME.test(name);
  if (looksLikeIdName && numericFrac >= THRESHOLDS.quantitative) {
    return { name, type: "identifier", confidence: 0.9, stats, examples };
  }

  // 4. Quantitative.
  if (numericFrac >= THRESHOLDS.quantitative) {
    return { name, type: "quantitative", confidence: numericFrac, stats, examples };
  }

  // 5. Categorical: few distinct values relative to the dataset. Checked before
  // distinctness-based identifier so a small sample of repeated categories is
  // not mistaken for unique ids.
  const catLimit = Math.max(
    THRESHOLDS.categoricalMaxDistinctAbs,
    Math.round(THRESHOLDS.categoricalMaxDistinctFrac * nonEmpty),
  );
  if (distinct <= catLimit) {
    const confidence = Math.min(1, 1 - distinctFrac + 0.2);
    return { name, type: "categorical", confidence, stats, examples };
  }

  // 6. Identifier by distinctness: (near-)unique values over a meaningful
  // sample. The min-rows guard avoids flagging tiny samples where everything
  // happens to be distinct.
  if (nonEmpty >= 20 && distinctFrac >= THRESHOLDS.identifier) {
    return { name, type: "identifier", confidence: distinctFrac, stats, examples };
  }

  // 7. Text fallback.
  return { name, type: "text", confidence: 1 - distinctFrac, stats, examples };
}

export interface DataProfile {
  columns: ColumnProfile[];
  rowCount: number;
}

/** Profile every column of a parsed table (sampled for performance). */
export function profileColumns(
  columns: string[],
  rows: Record<string, string>[],
  opts: { sample?: number } = {},
): DataProfile {
  const sampleSize = opts.sample ?? THRESHOLDS.sample;
  const sample = rows.length > sampleSize ? rows.slice(0, sampleSize) : rows;
  const profiles = columns.map((col) =>
    profileColumn(
      col,
      sample.map((r) => r[col] ?? ""),
    ),
  );
  return { columns: profiles, rowCount: rows.length };
}
