/**
 * Point layer construction (ROADMAP O2.4).
 *
 * Turns tabular rows with latitude/longitude columns into a GeoJSON
 * FeatureCollection of points, ready to render as a MapLibre `circle` layer.
 * Optionally carries a numeric value (for proportional size) and a category
 * (for colour). Rows with unparseable coordinates are dropped and counted.
 *
 * Coordinates accept Italian decimals ("45,46") via `parseNumber`, and are
 * range-checked (lat ∈ [-90,90], lon ∈ [-180,180]).
 */

import { parseNumber } from "./csv";

export interface BuildPointsParams {
  rows: Record<string, string>[];
  latColumn: string;
  lonColumn: string;
  /** Optional numeric column → `__value` (proportional size). */
  valueColumn?: string;
  /** Optional column → `__cat` (category colour). */
  categoryColumn?: string;
  /** Optional column used as the point label/name in tooltips. */
  nameColumn?: string;
}

export interface BuildPointsResult {
  geojson: GeoJSON.FeatureCollection;
  /** Number of rows dropped for invalid/missing coordinates. */
  dropped: number;
  /** Distinct categories encountered (in first-seen order), if any. */
  categories: string[];
  /** Min/max of the numeric value column, when present and non-empty. */
  valueRange?: { min: number; max: number };
}

/** Build point features from rows. Pure and deterministic. */
export function buildPointFeatures(params: BuildPointsParams): BuildPointsResult {
  const { rows, latColumn, lonColumn, valueColumn, categoryColumn, nameColumn } =
    params;

  const features: GeoJSON.Feature[] = [];
  const categories: string[] = [];
  const seenCat = new Set<string>();
  let dropped = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const row of rows) {
    const lat = parseNumber(row[latColumn]);
    const lon = parseNumber(row[lonColumn]);
    if (
      lat == null ||
      lon == null ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      dropped++;
      continue;
    }

    const properties: Record<string, unknown> = {};
    if (valueColumn) {
      const v = parseNumber(row[valueColumn]);
      if (v != null) {
        properties.__value = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (categoryColumn) {
      const cat = (row[categoryColumn] ?? "").trim();
      properties.__cat = cat;
      if (cat !== "" && !seenCat.has(cat)) {
        seenCat.add(cat);
        categories.push(cat);
      }
    }
    if (nameColumn) {
      properties.__name = (row[nameColumn] ?? "").trim();
    }

    features.push({
      type: "Feature",
      properties,
      geometry: { type: "Point", coordinates: [lon, lat] },
    });
  }

  const result: BuildPointsResult = {
    geojson: { type: "FeatureCollection", features },
    dropped,
    categories,
  };
  if (Number.isFinite(min) && Number.isFinite(max)) {
    result.valueRange = { min, max };
  }
  return result;
}

/**
 * Build a MapLibre `circle-color` expression that assigns a colour per category
 * from the given palette (cycled if there are more categories than colours).
 * Returns a flat colour string when there are no categories.
 */
export function buildPointColorExpression(
  categories: string[],
  palette: string[],
  fallback: string,
): unknown {
  if (categories.length === 0 || palette.length === 0) return fallback;
  const match: unknown[] = ["match", ["get", "__cat"]];
  categories.forEach((cat, i) => {
    match.push(cat, palette[i % palette.length]);
  });
  match.push(fallback); // default for empty/unknown category
  return match;
}

/**
 * Build a MapLibre `circle-radius` expression that scales the symbol with
 * `__value` between `minPx` and `maxPx`. Returns a constant radius when there
 * is no usable value range.
 */
export function buildPointRadiusExpression(
  valueRange: { min: number; max: number } | undefined,
  minPx: number,
  maxPx: number,
  constPx: number,
): unknown {
  if (!valueRange || valueRange.min === valueRange.max) return constPx;
  return [
    "interpolate",
    ["linear"],
    ["to-number", ["get", "__value"], valueRange.min],
    valueRange.min,
    minPx,
    valueRange.max,
    maxPx,
  ];
}
