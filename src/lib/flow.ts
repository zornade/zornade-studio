/**
 * Flow map geometry (O4 maps) - pure, tested.
 *
 * Turns origin→destination rows (two coordinate pairs each) into curved arcs
 * (quadratic Bézier, bowed perpendicular to the chord) ready for a MapLibre
 * `line` layer. Each arc carries `__value` (for width/colour), `__from`/`__to`
 * labels (for the tooltip). No new dependencies; output is plain GeoJSON.
 */

import { parseNumber } from "./csv";

export interface FlowRowColumns {
  fromLat: string;
  fromLon: string;
  toLat: string;
  toLon: string;
  /** Optional numeric magnitude column. */
  value?: string;
  /** Optional origin/destination label columns. */
  fromName?: string;
  toName?: string;
}

export interface BuildFlowsOptions {
  /** Curvature: control-point offset as a fraction of the chord. Default 0.2. */
  bend?: number;
  /** Segments per arc. Default 24. */
  segments?: number;
}

export interface BuildFlowsResult {
  geojson: GeoJSON.FeatureCollection;
  /** Rows dropped for invalid/missing coordinates. */
  dropped: number;
  /** Min/max of the value column, when present and non-empty. */
  valueRange?: { min: number; max: number };
}

const DEG2RAD = Math.PI / 180;

function inLat(n: number | null): n is number {
  return n != null && n >= -90 && n <= 90;
}
function inLon(n: number | null): n is number {
  return n != null && n >= -180 && n <= 180;
}

/**
 * Build one quadratic-Bézier arc (as a coordinate list) from `from` to `to`,
 * bowed perpendicular to the chord. The perpendicular is cos-lat corrected so
 * the bow looks symmetric at Italian latitudes.
 */
export function arcCoordinates(
  from: [number, number],
  to: [number, number],
  bend: number,
  segments: number,
): number[][] {
  const [x0, y0] = from;
  const [x1, y1] = to;
  const midLat = (y0 + y1) / 2;
  const cosLat = Math.cos(midLat * DEG2RAD) || 1;
  // Chord in a locally-isotropic frame (scale lng by cosLat).
  const dx = (x1 - x0) * cosLat;
  const dy = y1 - y0;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  // Perpendicular (-dy, dx); convert the lng component back out of the frame.
  const cx = mx - (dy * bend) / cosLat;
  const cy = my + dx * bend;
  const out: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
    const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
    out.push([x, y]);
  }
  return out;
}

/**
 * Build flow arcs from rows. Rows with invalid coordinates are dropped and
 * counted. Pure and deterministic.
 */
export function buildFlows(
  rows: Record<string, string>[],
  cols: FlowRowColumns,
  opts: BuildFlowsOptions = {},
): BuildFlowsResult {
  const bend = opts.bend ?? 0.2;
  const segments = opts.segments ?? 24;
  const features: GeoJSON.Feature[] = [];
  let dropped = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const row of rows) {
    const fLat = parseNumber(row[cols.fromLat]);
    const fLon = parseNumber(row[cols.fromLon]);
    const tLat = parseNumber(row[cols.toLat]);
    const tLon = parseNumber(row[cols.toLon]);
    if (!inLat(fLat) || !inLon(fLon) || !inLat(tLat) || !inLon(tLon)) {
      dropped++;
      continue;
    }
    const props: Record<string, unknown> = {};
    if (cols.value) {
      const v = parseNumber(row[cols.value]);
      if (v != null) {
        props.__value = v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (cols.fromName) props.__from = (row[cols.fromName] ?? "").trim();
    if (cols.toName) props.__to = (row[cols.toName] ?? "").trim();
    // A compact "A → B" name for the default tooltip.
    if (props.__from || props.__to) {
      props.__name = `${props.__from ?? ""} → ${props.__to ?? ""}`.trim();
    }
    features.push({
      type: "Feature",
      properties: props,
      geometry: {
        type: "LineString",
        coordinates: arcCoordinates([fLon, fLat], [tLon, tLat], bend, segments),
      },
    });
  }

  const result: BuildFlowsResult = {
    geojson: { type: "FeatureCollection", features },
    dropped,
  };
  if (Number.isFinite(min) && Number.isFinite(max)) {
    result.valueRange = { min, max };
  }
  return result;
}

/**
 * MapLibre `line-width` expression scaling with `__value` between `minPx` and
 * `maxPx`; a constant width when there is no usable value range.
 */
export function buildFlowWidthExpression(
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
