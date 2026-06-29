/**
 * Geographic levels supported by the choropleth pipeline and the geo-join +
 * classification logic that turns a parsed CSV into a coloured GeoJSON.
 *
 * Only "regioni" ships with bundled geometry today; "province" and "comuni"
 * are declared so the UI and join logic are ready as soon as their geometry
 * is added under public/geo/.
 */

import { parseNumber } from "./csv";

export type GeoLevel = "paesi" | "regioni" | "province" | "comuni";

export interface GeoLevelDef {
  id: GeoLevel;
  label: string;
  /** URL of the GeoJSON geometry (under public/). */
  url: string;
  /** Feature property used as the join key. */
  joinField: string;
  /** Feature property holding the human-readable name. */
  nameField: string;
  /**
   * Extra feature properties that may also carry a join key (e.g. an alternate
   * code like ISO-A2 alongside the primary ISO-A3). Matched after code + name.
   */
  aliasFields?: string[];
  /** CSV column names that, if present, signal this level (case-insensitive). */
  keyHints: string[];
  /** Whether the bundled geometry is available. */
  ready: boolean;
}

export const GEO_LEVELS: Record<GeoLevel, GeoLevelDef> = {
  paesi: {
    id: "paesi",
    label: "Paesi",
    url: "/geo/paesi.geojson",
    joinField: "iso_a3",
    nameField: "name",
    aliasFields: ["iso_a2", "name_en"],
    keyHints: [
      "iso_a3",
      "iso_a2",
      "iso",
      "iso3",
      "iso2",
      "codice_iso",
      "paese",
      "nazione",
      "stato",
      "country",
    ],
    ready: true,
  },
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
    aliasFields: ["prov_istat_code"],
    keyHints: ["sigla", "prov_acr", "provincia", "targa"],
    ready: true,
  },
  comuni: {
    id: "comuni",
    label: "Comuni",
    url: "/geo/comuni.geojson",
    joinField: "com_istat_code",
    nameField: "com_name",
    aliasFields: ["com_istat_code_num"],
    keyHints: ["com_istat_code", "pro_com", "comune", "codice_comune"],
    ready: true,
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

/** Default colour for features with no value (shared by app + embed). */
export const DEFAULT_NO_DATA_COLOR = "#e2e8f0";

/**
 * Ordered list of feature properties to try when joining a CSV key onto this
 * level's geometry: primary code → human name → any alternate code. The app's
 * join and the embed renderer must use the *same* order to match identically.
 */
export function geoJoinFields(level: GeoLevel): {
  fields: string[];
  nameField: string;
} {
  const def = GEO_LEVELS[level];
  return {
    fields: [def.joinField, def.nameField, ...(def.aliasFields ?? [])],
    nameField: def.nameField,
  };
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

/** Finer levels rank higher: used as a tie-break when match scores are close. */
const GEO_GRANULARITY: Record<GeoLevel, number> = {
  comuni: 4,
  province: 3,
  regioni: 2,
  paesi: 1,
};

export interface GeoCandidate {
  level: GeoLevel;
  keyColumn: string;
  /** Fraction of non-empty cells in `keyColumn` that match this level (0..1). */
  score: number;
}

export interface GeoResolution extends GeoCandidate {
  /** Best candidate for each *other* level, for a manual override in the UI. */
  alternatives: GeoCandidate[];
}

export interface ResolveOptions {
  /** Minimum match fraction for a column to be considered a key (default 0.5). */
  minScore?: number;
  /** Max rows sampled when scoring (default 1000). */
  sample?: number;
  /** Score gap within which the finer level wins the tie (default 0.15). */
  tieWindow?: number;
}

/**
 * Resolve the geographic level AND key column by matching actual CSV *values*
 * against the real geometry keys of each level - not by guessing from column
 * names. This is what tells a *comune* dataset (e.g. ACI "enteTerritoriale")
 * apart from its parent-*provincia* context column, which name-based detection
 * gets wrong.
 *
 * For every column × level it computes the fraction of cells that match that
 * level's keys; the best wins, with finer levels preferred on near-ties (a
 * comunal key column beats the province context column when both match well).
 * Returns null if nothing matches - the caller can fall back to name hints.
 *
 * @param keysByLevel normalised join keys per level (from /geo/keys.json).
 */
export function resolveGeoJoin(
  columns: string[],
  rows: Record<string, string>[],
  keysByLevel: Record<string, Iterable<string>>,
  opts: ResolveOptions = {},
): GeoResolution | null {
  const minScore = opts.minScore ?? 0.5;
  const sampleSize = opts.sample ?? 1000;
  const tieWindow = opts.tieWindow ?? 0.15;

  const sets = new Map<GeoLevel, Set<string>>();
  for (const level of Object.keys(GEO_LEVELS) as GeoLevel[]) {
    const keys = keysByLevel[level];
    if (keys) sets.set(level, keys instanceof Set ? keys : new Set(keys));
  }
  if (sets.size === 0) return null;

  const sample = rows.length > sampleSize ? rows.slice(0, sampleSize) : rows;
  // Track per-candidate whether the source column looks numeric (a measure):
  // a numeric column that coincidentally matches ISTAT codes must not beat a
  // genuine non-numeric key column on a score tie.
  const candidates: (GeoCandidate & { numeric: boolean })[] = [];

  for (const col of columns) {
    const normalised: string[] = [];
    let numericCells = 0;
    let nonEmpty = 0;
    for (const row of sample) {
      const v = row[col];
      if (v == null || String(v).trim() === "") continue;
      nonEmpty++;
      if (parseNumber(String(v)) != null) numericCells++;
      normalised.push(normaliseKey(v));
    }
    if (normalised.length === 0) continue;
    const numeric = nonEmpty > 0 && numericCells / nonEmpty >= 0.85;
    for (const [level, set] of sets) {
      let matched = 0;
      for (const n of normalised) if (n !== "" && set.has(n)) matched++;
      const score = matched / normalised.length;
      if (score >= minScore) candidates.push({ level, keyColumn: col, score, numeric });
    }
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (Math.abs(a.score - b.score) <= tieWindow) {
      // On a near-tie, a non-numeric key column beats a numeric one (the latter
      // is more likely a measure that coincidentally matches codes)…
      if (a.numeric !== b.numeric) return a.numeric ? 1 : -1;
      // …then prefer the finer geographic level.
      return GEO_GRANULARITY[b.level] - GEO_GRANULARITY[a.level];
    }
    return b.score - a.score;
  });

  const best = candidates[0];
  const seen = new Set<GeoLevel>([best.level]);
  const alternatives: GeoCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.level)) continue;
    seen.add(c.level);
    alternatives.push({ level: c.level, keyColumn: c.keyColumn, score: c.score });
  }
  return { level: best.level, keyColumn: best.keyColumn, score: best.score, alternatives };
}

/** Best key column for a specific level (used when the user overrides level). */
export function bestKeyColumnForLevel(
  level: GeoLevel,
  columns: string[],
  rows: Record<string, string>[],
  keysByLevel: Record<string, Iterable<string>>,
  opts: ResolveOptions = {},
): string | null {
  const keys = keysByLevel[level];
  if (!keys) return null;
  const set = keys instanceof Set ? keys : new Set(keys);
  const sampleSize = opts.sample ?? 1000;
  const sample = rows.length > sampleSize ? rows.slice(0, sampleSize) : rows;
  let bestCol: string | null = null;
  let bestScore = -1;
  for (const col of columns) {
    let total = 0;
    let matched = 0;
    for (const row of sample) {
      const v = row[col];
      if (v == null || String(v).trim() === "") continue;
      total++;
      if (set.has(normaliseKey(v))) matched++;
    }
    if (total === 0) continue;
    const score = matched / total;
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }
  return bestCol;
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
  const [min, max] = minMaxOf(values);
  const step = (max - min) / nClasses;
  const raw: number[] = [];
  for (let i = 1; i < nClasses; i++) raw.push(min + step * i);
  return { breaks: ascendingUnique(raw), min, max };
}

/** Min/max via a single pass (safe for large arrays, unlike `Math.min(...xs)`
 * which can overflow the call stack on thousands of comuni). */
function minMaxOf(values: number[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min)) return [0, 0];
  return [min, max];
}

/**
 * Natural breaks (Fisher–Jenks) - minimises within-class variance, the method
 * cartographers expect for "natural breaks". Uses the classic dynamic-program;
 * for large inputs the sorted values are down-sampled to {@link JENKS_MAX} to
 * keep it fast (breaks computed on a representative subsample are virtually
 * identical to the full result, and far cheaper than the O(k·n²) full run on
 * thousands of comuni).
 */
const JENKS_MAX = 600;
export function jenksBreaks(values: number[], nClasses: number): ClassBreaks {
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;

  // Down-sample (keeping the extremes) when there are too many points.
  let data = sorted;
  if (sorted.length > JENKS_MAX) {
    const step = (sorted.length - 1) / (JENKS_MAX - 1);
    data = [];
    for (let i = 0; i < JENKS_MAX; i++) data.push(sorted[Math.round(i * step)]);
  }

  const n = data.length;
  const k = Math.min(nClasses, n);
  if (k <= 1) return { breaks: [], min, max };
  if (k >= n) return { breaks: ascendingUnique(data.slice(1)), min, max };

  // Dynamic programming matrices (1-indexed).
  const lowerClass: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(k + 1).fill(0),
  );
  const variance: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(k + 1).fill(Infinity),
  );
  for (let i = 1; i <= k; i++) {
    lowerClass[1][i] = 1;
    variance[1][i] = 0;
  }

  for (let l = 2; l <= n; l++) {
    let sum = 0;
    let sumSq = 0;
    let count = 0;
    for (let m = 1; m <= l; m++) {
      const lower = l - m + 1; // index of the value entering the window
      const val = data[lower - 1];
      count++;
      sum += val;
      sumSq += val * val;
      const v = sumSq - (sum * sum) / count; // variance × count of the window
      const i4 = lower - 1;
      if (i4 !== 0) {
        for (let j = 2; j <= k; j++) {
          if (variance[l][j] >= v + variance[i4][j - 1]) {
            lowerClass[l][j] = lower;
            variance[l][j] = v + variance[i4][j - 1];
          }
        }
      }
    }
    lowerClass[l][1] = 1;
    variance[l][1] = sumSq - (sum * sum) / count;
  }

  // Back-track the class lower bounds into break values.
  const raw: number[] = [];
  let kk = k;
  let idx = n;
  while (kk > 1) {
    const id = lowerClass[idx][kk] - 2;
    raw.push(data[id + 1]);
    idx = lowerClass[idx][kk] - 1;
    kk--;
  }
  raw.reverse();
  return { breaks: ascendingUnique(raw), min, max };
}

/**
 * Manual class breaks: the operator supplies the thresholds explicitly. Invalid
 * or out-of-order entries are sanitised (ascending, deduped); empty → no
 * classes (single colour). `min`/`max` come from the data for the legend.
 */
export function manualBreaks(values: number[], thresholds: number[]): ClassBreaks {
  const [min, max] = minMaxOf(values);
  const clean = ascendingUnique(
    thresholds.filter((t) => Number.isFinite(t)).sort((a, b) => a - b),
  );
  return { breaks: clean, min, max };
}

/**
 * Canonical classification dispatch shared by the live map and the published
 * embed, so a map always classifies the same way wherever it is rendered.
 * Empty input → no classes (single colour); unknown method → quantile.
 */
export function computeBreaks(
  values: number[],
  method: string,
  nClasses: number,
  manualThresholds: number[] = [],
): ClassBreaks {
  if (values.length === 0) return { breaks: [], min: 0, max: 0 };
  switch (method) {
    case "equal":
      return equalBreaks(values, nClasses);
    case "jenks":
      return jenksBreaks(values, nClasses);
    case "manual":
      return manualBreaks(values, manualThresholds);
    default:
      return quantileBreaks(values, nClasses);
  }
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
  /** Thresholds used when method === "manual". */
  manualBreaks?: number[];
  /** Extra columns to copy from the matched row onto each feature (for custom
   * tooltips), prefixed with `col:` to avoid clashing with geometry props. */
  extraColumns?: string[];
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
  // And, when a custom tooltip needs them, key -> the matched row.
  const extraColumns = params.extraColumns ?? [];
  const rowByKey =
    extraColumns.length > 0 ? new Map<string, Record<string, string>>() : null;
  const unmatchedCsv: string[] = [];
  for (const row of rows) {
    const key = normaliseKey(row[keyColumn]);
    const value = parseNumber(row[valueColumn]);
    if (key === "" || value == null) continue;
    valueByKey.set(key, value);
    if (rowByKey) rowByKey.set(key, row);
  }

  const matched = new Set<string>();
  let noDataFeatures = 0;
  // Values actually painted onto a feature. Classification MUST use these, not
  // every CSV row: an aggregate/total row (e.g. "Italia") or a row whose area
  // isn't in the geometry would otherwise skew the breaks so that no rendered
  // feature reaches the top class (the darkest colour would never appear).
  const renderedValues: number[] = [];

  const features = geojson.features.map((f) => {
    const props = (f.properties as Record<string, unknown>) ?? {};
    // Match the CSV key against the code field, then the human-readable name,
    // then any alternate code (alias) field - so a dataset keyed by ISO-A3,
    // ISO-A2, full name, province code or acronym all join equally well.
    const candidates = [
      props[def.joinField],
      props[def.nameField],
      ...(def.aliasFields ?? []).map((field) => props[field]),
    ];
    let matchedKey = "";
    let value: number | undefined;
    for (const candidate of candidates) {
      const key = normaliseKey(candidate as string);
      if (key !== "" && valueByKey.has(key)) {
        matchedKey = key;
        value = valueByKey.get(key);
        break;
      }
    }
    const properties = { ...props };
    if (value != null) {
      properties.__value = value;
      matched.add(matchedKey);
      renderedValues.push(value);
      // Copy template-referenced columns under a `col:` prefix.
      if (rowByKey) {
        const row = rowByKey.get(matchedKey);
        if (row) {
          for (const c of extraColumns) properties[`col:${c}`] = row[c] ?? "";
        }
      }
    } else {
      delete properties.__value;
      noDataFeatures++;
    }
    return { ...f, properties } as GeoJSON.Feature;
  });

  for (const key of valueByKey.keys()) {
    if (!matched.has(key)) unmatchedCsv.push(key);
  }

  const classes = computeBreaks(
    renderedValues,
    method,
    nClasses,
    params.manualBreaks ?? [],
  );

  return {
    geojson: { type: "FeatureCollection", features },
    matched: [...matched],
    unmatchedCsv,
    noDataFeatures,
    classes,
  };
}

/**
 * Values actually painted onto features, in feature order - i.e. the exact
 * distribution a choropleth renders for this geometry. Mirrors the join in
 * {@link joinChoropleth} (same candidate fields + normalisation) but returns
 * only the numbers, so the publish path can classify on the **same** rendered
 * values the live editor uses, without re-parsing strings.
 *
 * @param valueByKey normalised CSV key → numeric value (last value wins).
 */
export function matchedFeatureValues(
  geojson: GeoJSON.FeatureCollection,
  level: GeoLevel,
  valueByKey: Map<string, number>,
): number[] {
  const { fields } = geoJoinFields(level);
  const out: number[] = [];
  for (const f of geojson.features) {
    const props = (f.properties as Record<string, unknown>) ?? {};
    for (const field of fields) {
      const key = normaliseKey(props[field] as string);
      if (key !== "" && valueByKey.has(key)) {
        out.push(valueByKey.get(key)!);
        break;
      }
    }
  }
  return out;
}

/**
 * Collect the values actually painted on features across **all** time frames of
 * a temporal choropleth (ROADMAP O3.3). Used to compute a **single, shared**
 * classification so colours are comparable across periods (a value means the
 * same colour in 2015 and 2025). Mirrors {@link joinChoropleth}'s matching via
 * {@link matchedFeatureValues}, so the population is exactly the rendered one.
 */
export function temporalSharedValues(params: {
  geojson: GeoJSON.FeatureCollection;
  level: GeoLevel;
  rows: Record<string, string>[];
  keyColumn: string;
  valueColumn: string;
  timeColumn: string;
  frames: string[];
}): number[] {
  const { geojson, level, rows, keyColumn, valueColumn, timeColumn, frames } = params;
  // Group rows by frame once (avoids re-scanning all rows per frame).
  const byFrame = new Map<string, Map<string, number>>();
  for (const f of frames) byFrame.set(f, new Map());
  for (const row of rows) {
    const frame = (row[timeColumn] ?? "").trim();
    const bucket = byFrame.get(frame);
    if (!bucket) continue;
    const key = normaliseKey(row[keyColumn]);
    const value = parseNumber(row[valueColumn]);
    if (key === "" || value == null) continue;
    bucket.set(key, value);
  }
  const out: number[] = [];
  for (const f of frames) {
    const bucket = byFrame.get(f);
    if (!bucket || bucket.size === 0) continue;
    for (const v of matchedFeatureValues(geojson, level, bucket)) out.push(v);
  }
  return out;
}

/**
 * Join a **categorical** column onto the geometry (ROADMAP O2.6 - category
 * map). Mirrors {@link joinChoropleth}'s code→name→alias matching, but injects
 * a string `__cat` per matched feature and collects the distinct categories
 * (first-seen order) so the renderer can assign a colour each.
 */
export interface CategoryJoinResult {
  geojson: GeoJSON.FeatureCollection;
  /** Distinct categories in first-seen order. */
  categories: string[];
  /** Count of features with no matching category (rendered as "no data"). */
  noDataFeatures: number;
}

export function joinCategory(params: {
  geojson: GeoJSON.FeatureCollection;
  level: GeoLevel;
  rows: Record<string, string>[];
  keyColumn: string;
  categoryColumn: string;
}): CategoryJoinResult {
  const { geojson, level, rows, keyColumn, categoryColumn } = params;
  const def = GEO_LEVELS[level];

  const catByKey = new Map<string, string>();
  for (const row of rows) {
    const key = normaliseKey(row[keyColumn]);
    const cat = (row[categoryColumn] ?? "").trim();
    if (key === "" || cat === "") continue;
    catByKey.set(key, cat);
  }

  const categories: string[] = [];
  const seenCat = new Set<string>();
  let noDataFeatures = 0;

  const features = geojson.features.map((f) => {
    const props = (f.properties as Record<string, unknown>) ?? {};
    const candidates = [
      props[def.joinField],
      props[def.nameField],
      ...(def.aliasFields ?? []).map((field) => props[field]),
    ];
    let cat: string | undefined;
    for (const candidate of candidates) {
      const key = normaliseKey(candidate as string);
      if (key !== "" && catByKey.has(key)) {
        cat = catByKey.get(key);
        break;
      }
    }
    const properties = { ...props };
    if (cat != null) {
      properties.__cat = cat;
      if (!seenCat.has(cat)) {
        seenCat.add(cat);
        categories.push(cat);
      }
    } else {
      delete properties.__cat;
      noDataFeatures++;
    }
    return { ...f, properties } as GeoJSON.Feature;
  });

  return {
    geojson: { type: "FeatureCollection", features },
    categories,
    noDataFeatures,
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
  const hasValue: unknown = ["==", ["typeof", ["get", "__value"]], "number"];

  // With no thresholds there is a single class: a MapLibre `step` with zero
  // stops is invalid, so paint a solid colour for any value, no-data otherwise.
  if (classes.breaks.length === 0) {
    return ["case", hasValue, ramp[0], noDataColor];
  }

  // step expression: [step, input, color0, break0, color1, break1, ...]
  const step: unknown[] = ["step", ["to-number", ["get", "__value"]], ramp[0]];
  classes.breaks.forEach((b, i) => {
    step.push(b, ramp[i + 1]);
  });

  return ["case", hasValue, step, noDataColor];
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
