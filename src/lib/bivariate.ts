/**
 * Bivariate choropleth (O4.x maps) — pure, tested.
 *
 * A bivariate map colours each area by the combination of TWO variables: each
 * variable is split into 3 classes (terciles) and the pair (a, b) selects one
 * of 9 colours from a 3×3 matrix. This module joins two value columns onto the
 * geometry (mirroring `joinChoropleth`'s matching), assigns each area a class
 * 0..8, and exposes the palette + a MapLibre `match` paint expression.
 *
 * The matrix index is `row * 3 + col` where `row` = class of variable B
 * (vertical axis) and `col` = class of variable A (horizontal axis), so
 * `BIVARIATE_PALETTE[index]` lines up with a legend drawn bottom-up.
 */

import { GEO_LEVELS, normaliseKey, computeBreaks, type GeoLevel } from "./choropleth";
import { parseNumber } from "./csv";

/**
 * 3×3 bivariate palette (teal × red, the classic Joshua Stevens scheme),
 * indexed `row*3 + col`:
 *  - col (→) = variable A low→high
 *  - row (↑) = variable B low→high (index 0..2 = bottom→top)
 * Bottom-left (0) = both low (pale grey); top-right (8) = both high (dark).
 */
export const BIVARIATE_PALETTE: string[] = [
  "#e8e8e8", "#e4acac", "#c85a5a", // row 0 (B low):  A low→high
  "#b0d5df", "#ad9ea5", "#985356", // row 1 (B mid)
  "#64acbe", "#627f8c", "#574249", // row 2 (B high)
];

/** Class (0,1,2) of a value given two tercile thresholds. */
export function tercileClass(value: number, breaks: number[]): 0 | 1 | 2 {
  if (breaks.length === 0) return 1;
  if (value <= breaks[0]) return 0;
  if (breaks.length === 1 || value <= breaks[1]) return 1;
  return 2;
}

export interface BivariateResult {
  /** Geometry with `__biv` (0..8), `__a`, `__b` injected on matched features. */
  geojson: GeoJSON.FeatureCollection;
  /** Tercile thresholds for each variable (length ≤ 2). */
  breaksA: number[];
  breaksB: number[];
  /** Value ranges, for the legend axis labels. */
  rangeA: { min: number; max: number };
  rangeB: { min: number; max: number };
  /** Number of areas that matched both variables. */
  matched: number;
}

export interface BivariateParams {
  geojson: GeoJSON.FeatureCollection;
  level: GeoLevel;
  rows: Record<string, string>[];
  keyColumn: string;
  columnA: string;
  columnB: string;
}

/**
 * Join two value columns onto the geometry and assign each matched area a
 * bivariate class 0..8. Features missing either value get no `__biv` (rendered
 * as "no data"). Classification uses the values actually painted (terciles of
 * the matched distribution), matching `joinChoropleth`'s philosophy.
 */
export function joinBivariate(params: BivariateParams): BivariateResult {
  const { geojson, level, rows, keyColumn, columnA, columnB } = params;
  const def = GEO_LEVELS[level];

  const aByKey = new Map<string, number>();
  const bByKey = new Map<string, number>();
  for (const row of rows) {
    const key = normaliseKey(row[keyColumn]);
    if (key === "") continue;
    const a = parseNumber(row[columnA]);
    const b = parseNumber(row[columnB]);
    if (a != null) aByKey.set(key, a);
    if (b != null) bByKey.set(key, b);
  }

  const fields = [def.joinField, def.nameField, ...(def.aliasFields ?? [])];
  // First pass: match features, collect the painted values for classification.
  const matchedAVals: number[] = [];
  const matchedBVals: number[] = [];
  const featureKeys: (string | null)[] = geojson.features.map((f) => {
    const props = (f.properties as Record<string, unknown>) ?? {};
    for (const field of fields) {
      const key = normaliseKey(props[field] as string);
      if (key !== "" && aByKey.has(key) && bByKey.has(key)) {
        matchedAVals.push(aByKey.get(key)!);
        matchedBVals.push(bByKey.get(key)!);
        return key;
      }
    }
    return null;
  });

  const breaksA = computeBreaks(matchedAVals, "quantile", 3).breaks;
  const breaksB = computeBreaks(matchedBVals, "quantile", 3).breaks;

  let matched = 0;
  const features = geojson.features.map((f, i) => {
    const props = { ...((f.properties as Record<string, unknown>) ?? {}) };
    const key = featureKeys[i];
    if (key != null) {
      const a = aByKey.get(key)!;
      const b = bByKey.get(key)!;
      const col = tercileClass(a, breaksA);
      const rowC = tercileClass(b, breaksB);
      props.__a = a;
      props.__b = b;
      props.__biv = rowC * 3 + col;
      matched++;
    } else {
      delete props.__biv;
    }
    return { ...f, properties: props } as GeoJSON.Feature;
  });

  return {
    geojson: { type: "FeatureCollection", features },
    breaksA,
    breaksB,
    rangeA: rangeOf(matchedAVals),
    rangeB: rangeOf(matchedBVals),
    matched,
  };
}

function rangeOf(values: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

/**
 * MapLibre `fill-color` expression mapping `__biv` (0..8) to its palette colour,
 * with a fallback for features that have no class ("no data").
 */
export function buildBivariateColorExpression(
  palette: string[],
  noData: string,
): unknown {
  const match: unknown[] = ["match", ["get", "__biv"]];
  for (let i = 0; i < palette.length; i++) {
    match.push(i, palette[i]);
  }
  match.push(noData);
  return match;
}
