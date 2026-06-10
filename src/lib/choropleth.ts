/**
 * Geographic levels supported by the choropleth pipeline and the geo-join +
 * classification logic that turns a parsed CSV into a coloured GeoJSON.
 *
 * Only "regioni" ships with bundled geometry today; "province" and "comuni"
 * are declared so the UI and join logic are ready as soon as their geometry
 * is added under public/geo/.
 */

import { parseNumber } from "./csv";

export type GeoLevel = "regioni" | "province" | "comuni";

export interface GeoLevelDef {
  id: GeoLevel;
  label: string;
  /** URL of the GeoJSON geometry (under public/). */
  url: string;
  /** Feature property used as the join key. */
  joinField: string;
  /** Feature property holding the human-readable name. */
  nameField: string;
  /** CSV column names that, if present, signal this level (case-insensitive). */
  keyHints: string[];
  /** Whether the bundled geometry is available. */
  ready: boolean;
}

export const GEO_LEVELS: Record<GeoLevel, GeoLevelDef> = {
  regioni: {
    id: "regioni",
    label: "Regioni",
    url: "/geo/regioni.geojson",
    joinField: "reg_istat_code",
    nameField: "reg_name",
    keyHints: ["codice_istat", "cod_reg", "reg_istat_code", "regione"],
    ready: true,
  },
  province: {
    id: "province",
    label: "Province",
    url: "/geo/province.geojson",
    joinField: "prov_acr",
    nameField: "prov_name",
    keyHints: ["sigla", "prov_acr", "provincia", "targa"],
    ready: false,
  },
  comuni: {
    id: "comuni",
    label: "Comuni",
    url: "/geo/comuni.geojson",
    joinField: "com_istat_code",
    nameField: "com_name",
    keyHints: ["com_istat_code", "pro_com", "comune"],
    ready: false,
  },
};

/** Normalise a join key for tolerant matching (codes and names). */
export function normaliseKey(raw: string | number | undefined | null): string {
  if (raw == null) return "";
  let s = String(raw).trim().toLowerCase();
  // Zero-pad short numeric ISTAT codes (e.g. "1" -> "01").
  if (/^\d$/.test(s)) s = "0" + s;
  // For names: drop bilingual variants and accents for looser matching.
  s = s.split("/")[0].trim();
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return s;
}

/**
 * Pick the geographic level whose key hints best match the CSV columns.
 * Returns null if nothing matches.
 */
export function detectGeoLevel(columns: string[]): GeoLevel | null {
  const lower = columns.map((c) => c.toLowerCase());
  for (const level of Object.values(GEO_LEVELS)) {
    if (level.keyHints.some((h) => lower.includes(h))) return level.id;
  }
  return null;
}

/** Pick the CSV column matching this level's key hints. */
export function detectKeyColumn(
  level: GeoLevel,
  columns: string[],
): string | null {
  const def = GEO_LEVELS[level];
  const lower = columns.map((c) => c.toLowerCase());
  for (const hint of def.keyHints) {
    const idx = lower.indexOf(hint);
    if (idx !== -1) return columns[idx];
  }
  return null;
}

export interface ClassBreaks {
  /** Upper bounds of each class except the last (length = nClasses - 1). */
  breaks: number[];
  min: number;
  max: number;
}

/** Quantile class breaks over the given values (strictly ascending, deduped). */
export function quantileBreaks(values: number[], nClasses: number): ClassBreaks {
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const raw: number[] = [];
  for (let i = 1; i < nClasses; i++) {
    const q = (i / nClasses) * (sorted.length - 1);
    const lo = Math.floor(q);
    const hi = Math.ceil(q);
    const val = sorted[lo] + (sorted[hi] - sorted[lo]) * (q - lo);
    raw.push(val);
  }
  return { breaks: ascendingUnique(raw), min, max };
}

/** Equal-interval class breaks (strictly ascending, deduped). */
export function equalBreaks(values: number[], nClasses: number): ClassBreaks {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = (max - min) / nClasses;
  const raw: number[] = [];
  for (let i = 1; i < nClasses; i++) raw.push(min + step * i);
  return { breaks: ascendingUnique(raw), min, max };
}

/** Keep only strictly ascending values (drops duplicates that would break a
 * MapLibre `step` expression, which requires strictly ascending stops). */
function ascendingUnique(values: number[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (out.length === 0 || v > out[out.length - 1]) out.push(v);
  }
  return out;
}

export interface JoinResult {
  /** GeoJSON with a numeric `__value` injected on matched features. */
  geojson: GeoJSON.FeatureCollection;
  /** join keys present in the CSV that matched a feature. */
  matched: string[];
  /** CSV keys that did not match any feature. */
  unmatchedCsv: string[];
  /** Count of features with no value (rendered as "no data"). */
  noDataFeatures: number;
  classes: ClassBreaks;
}

export interface JoinParams {
  geojson: GeoJSON.FeatureCollection;
  level: GeoLevel;
  rows: Record<string, string>[];
  keyColumn: string;
  valueColumn: string;
  nClasses: number;
  method: string;
}

/**
 * Join CSV rows onto the geometry by key and compute class breaks.
 * Mutates a deep-ish copy of the geometry (features are shallow-cloned with a
 * fresh properties object carrying `__value`).
 */
export function joinChoropleth(params: JoinParams): JoinResult {
  const { geojson, level, rows, keyColumn, valueColumn, nClasses, method } =
    params;
  const def = GEO_LEVELS[level];

  // Build a lookup of normalised CSV key -> numeric value.
  const valueByKey = new Map<string, number>();
  const unmatchedCsv: string[] = [];
  for (const row of rows) {
    const key = normaliseKey(row[keyColumn]);
    const value = parseNumber(row[valueColumn]);
    if (key === "" || value == null) continue;
    valueByKey.set(key, value);
  }

  const matched = new Set<string>();
  let noDataFeatures = 0;

  const features = geojson.features.map((f) => {
    const featureKey = normaliseKey(
      (f.properties as Record<string, unknown>)?.[def.joinField] as string,
    );
    const value = valueByKey.get(featureKey);
    const properties = { ...(f.properties ?? {}) } as Record<string, unknown>;
    if (value != null) {
      properties.__value = value;
      matched.add(featureKey);
    } else {
      delete properties.__value;
      noDataFeatures++;
    }
    return { ...f, properties } as GeoJSON.Feature;
  });

  for (const key of valueByKey.keys()) {
    if (!matched.has(key)) unmatchedCsv.push(key);
  }

  const values = [...valueByKey.values()];
  const classes =
    values.length === 0
      ? { breaks: [], min: 0, max: 0 }
      : method === "equal"
        ? equalBreaks(values, nClasses)
        : quantileBreaks(values, nClasses);

  return {
    geojson: { type: "FeatureCollection", features },
    matched: [...matched],
    unmatchedCsv,
    noDataFeatures,
    classes,
  };
}

/**
 * Build a MapLibre `step` paint expression mapping `__value` to colors.
 * Features without `__value` fall through to `noDataColor`.
 */
export function buildFillColorExpression(
  classes: ClassBreaks,
  colors: string[],
  noDataColor: string,
): unknown {
  // Choose evenly spaced colors from the ramp for the number of classes.
  const nClasses = classes.breaks.length + 1;
  const ramp = sampleColors(colors, nClasses);

  // step expression: [step, input, color0, break0, color1, break1, ...]
  const step: unknown[] = ["step", ["to-number", ["get", "__value"]], ramp[0]];
  classes.breaks.forEach((b, i) => {
    step.push(b, ramp[i + 1]);
  });

  return [
    "case",
    ["==", ["typeof", ["get", "__value"]], "number"],
    step,
    noDataColor,
  ];
}

/** Sample n colors from a ramp, interpolating between stops for smoothness. */
export function sampleColors(ramp: string[], n: number): string[] {
  if (n <= 1) return [ramp[ramp.length - 1]];
  if (ramp.length === 0) return [];
  if (ramp.length === 1) return Array(n).fill(ramp[0]);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (ramp.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    out.push(lerpHex(ramp[lo], ramp[hi], pos - lo));
  }
  return out;
}

/** Linear interpolation between two hex colors. */
function lerpHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return a;
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
