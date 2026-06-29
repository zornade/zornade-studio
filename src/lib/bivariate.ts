/**
 * Bivariate choropleth (O4.x maps) - pure, tested.
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

/** A named, selectable 3×3 bivariate palette (same index layout as above). */
export interface BivariatePalette {
  id: string;
  label: string;
  colors: string[];
}

/**
 * Selectable bivariate palettes. All nine-colour schemes by Joshua Stevens /
 * Cynthia Brewer (via the R `pals` package), sharing the same `row*3 + col`
 * layout: index 0 = both variables low (pale), index 8 = both high (dark).
 * The first entry is the historical default and is byte-identical to
 * `BIVARIATE_PALETTE` for back-compatibility with existing specs.
 */
export const BIVARIATE_PALETTES: BivariatePalette[] = [
  {
    id: "teal-red",
    label: "Verde-azzurro × Rosso",
    colors: [
      "#e8e8e8", "#e4acac", "#c85a5a",
      "#b0d5df", "#ad9ea5", "#985356",
      "#64acbe", "#627f8c", "#574249",
    ],
  },
  {
    id: "pink-blue",
    label: "Rosa × Blu",
    colors: [
      "#e8e8e8", "#ace4e4", "#5ac8c8",
      "#dfb0d6", "#a5add3", "#5698b9",
      "#be64ac", "#8c62aa", "#3b4994",
    ],
  },
  {
    id: "green-blue",
    label: "Verde × Blu",
    colors: [
      "#e8e8e8", "#b5c0da", "#6c83b5",
      "#b8d6be", "#90b2b3", "#567994",
      "#73ae80", "#5a9178", "#2a5a5b",
    ],
  },
  {
    id: "purple-gold",
    label: "Viola × Oro",
    colors: [
      "#e8e8e8", "#e4d9ac", "#c8b35a",
      "#cbb8d7", "#c8ada0", "#af8e53",
      "#9972af", "#976b82", "#804d36",
    ],
  },
  {
    id: "pink-green",
    label: "Rosa × Verde",
    colors: [
      "#f3f3f3", "#c2f1ce", "#8be2af",
      "#eac5dd", "#9ec6d3", "#7fc6b1",
      "#e6a3d0", "#bc9fce", "#7b8eaf",
    ],
  },
];

/** Default bivariate palette id (the historical teal × red scheme). */
export const DEFAULT_BIVARIATE_PALETTE_ID = BIVARIATE_PALETTES[0].id;

/**
 * Resolve a palette id to its 9 colours, falling back to the default scheme
 * for unknown/empty ids (keeps old specs and bad input rendering correctly).
 */
export function bivariatePaletteColors(id: string | undefined | null): string[] {
  const found = BIVARIATE_PALETTES.find((p) => p.id === id);
  return (found ?? BIVARIATE_PALETTES[0]).colors;
}

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
