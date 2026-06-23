/**
 * Visualisation compatibility engine (ROADMAP §1.12.5).
 *
 * Given a {@link DataProfile} (column semantic types) plus the value-based geo
 * resolution ({@link GeoResolution} from lib/choropleth.ts), it decides, for
 * every catalog viz type, whether the loaded data supports it — and, if not,
 * *why* (the missing requirement). This replaces the hardcoded
 * `new Set(["choropleth"])` previously in VisualizePanel.
 *
 * It only judges DATA compatibility; whether a viz is actually rendered yet is
 * a separate concern (the catalog `status` + implemented set in the panel).
 */

import type { DataProfile } from "./profile";
import type { GeoResolution } from "./choropleth";
import { VIZ_GROUPS } from "../studio/catalog";

export interface VizCompatibility {
  id: string;
  compatible: boolean;
  /** Heuristic score 0..1 (higher = better fit) for ordering suggestions. */
  score: number;
  /** Human reason shown when not compatible. */
  reason?: string;
}

/** The data shape distilled from the profile, used by the rules. */
interface DataShape {
  hasGeoArea: boolean;
  hasGeoPoint: boolean;
  nQuant: number;
  nCategorical: number;
  nTemporal: number;
  nText: number;
}

function shapeOf(profile: DataProfile, geo: GeoResolution | null): DataShape {
  let nQuant = 0;
  let nCategorical = 0;
  let nTemporal = 0;
  let nText = 0;
  let hasLat = false;
  let hasLon = false;
  for (const c of profile.columns) {
    switch (c.type) {
      case "quantitative":
        nQuant++;
        break;
      case "categorical":
        nCategorical++;
        break;
      case "temporal":
        nTemporal++;
        break;
      case "text":
        nText++;
        break;
      case "geo-point-lat":
        hasLat = true;
        break;
      case "geo-point-lon":
        hasLon = true;
        break;
    }
  }
  return {
    hasGeoArea: geo != null,
    hasGeoPoint: hasLat && hasLon,
    nQuant,
    nCategorical,
    nTemporal,
    nText,
  };
}

type Rule = (s: DataShape) => { ok: boolean; reason?: string; score?: number };

const NEED_GEO_AREA_VALUE: Rule = (s) =>
  s.hasGeoArea && s.nQuant >= 1
    ? { ok: true, score: 0.9 }
    : {
        ok: false,
        reason: !s.hasGeoArea
          ? "serve una colonna geografica (regione/provincia/comune/paese)"
          : "serve una colonna numerica da mappare",
      };

const NEED_GEO_AREA_CATEGORY: Rule = (s) =>
  s.hasGeoArea && s.nCategorical >= 1
    ? { ok: true, score: 0.8 }
    : {
        ok: false,
        reason: !s.hasGeoArea
          ? "serve una colonna geografica"
          : "serve una colonna di categorie",
      };

const NEED_GEO_POINT: Rule = (s) =>
  s.hasGeoPoint
    ? { ok: true, score: 0.85 }
    : { ok: false, reason: "servono coordinate (latitudine e longitudine)" };

const NEED_CAT_OR_TIME_VALUE: Rule = (s) =>
  (s.nCategorical >= 1 || s.nTemporal >= 1) && s.nQuant >= 1
    ? { ok: true, score: 0.7 }
    : {
        ok: false,
        reason:
          s.nQuant < 1
            ? "serve una colonna numerica"
            : "serve una colonna di categorie o temporale per l'asse",
      };

const NEED_TWO_QUANT: Rule = (s) =>
  s.nQuant >= 2
    ? { ok: true, score: 0.7 }
    : { ok: false, reason: "servono due colonne numeriche" };

const NEED_ONE_QUANT: Rule = (s) =>
  s.nQuant >= 1
    ? { ok: true, score: 0.6 }
    : { ok: false, reason: "serve una colonna numerica" };

const NEED_CAT_VALUE: Rule = (s) =>
  s.nCategorical >= 1 && s.nQuant >= 1
    ? { ok: true, score: 0.7 }
    : {
        ok: false,
        reason:
          s.nQuant < 1 ? "serve una colonna numerica" : "serve una colonna di categorie",
      };

const NEED_TIME_VALUE: Rule = (s) =>
  s.nTemporal >= 1 && s.nQuant >= 1
    ? { ok: true, score: 0.7 }
    : {
        ok: false,
        reason: s.nTemporal < 1 ? "serve una colonna temporale" : "serve una colonna numerica",
      };

const NEED_RELATION: Rule = (s) =>
  s.nCategorical >= 2 && s.nQuant >= 1
    ? { ok: true, score: 0.6 }
    : { ok: false, reason: "servono due colonne di categorie + una numerica" };

const NEED_TEXT: Rule = (s) =>
  s.nText >= 1 || s.nCategorical >= 1
    ? { ok: true, score: 0.5 }
    : { ok: false, reason: "serve una colonna di testo" };

const ALWAYS: Rule = () => ({ ok: true, score: 0.4 });
const NOT_DATA_DRIVEN: Rule = () => ({
  ok: false,
  reason: "non si basa sui dati tabellari caricati",
});

/** Map every catalog viz id to its data requirement. */
const RULES: Record<string, Rule> = {
  // Maps — area-based.
  choropleth: NEED_GEO_AREA_VALUE,
  symbol: NEED_GEO_AREA_VALUE,
  bivariate: (s) =>
    s.hasGeoArea && s.nQuant >= 2
      ? { ok: true, score: 0.7 }
      : { ok: false, reason: "servono una colonna geografica e due numeriche" },
  extrusion: NEED_GEO_AREA_VALUE,
  cartogram: NEED_GEO_AREA_VALUE,
  spike: NEED_GEO_AREA_VALUE,
  category: NEED_GEO_AREA_CATEGORY,
  // Maps — point-based.
  points: NEED_GEO_POINT,
  locator: NEED_GEO_POINT,
  dotdensity: NEED_GEO_POINT,
  heatmap: NEED_GEO_POINT,
  hexbin: NEED_GEO_POINT,
  flow: (s) =>
    s.nQuant >= 4
      ? { ok: true, score: 0.6 }
      : { ok: false, reason: "servono 4 colonne numeriche: coordinate di origine e destinazione" },
  raster: NOT_DATA_DRIVEN,
  // Charts.
  bar: NEED_CAT_OR_TIME_VALUE,
  line: NEED_CAT_OR_TIME_VALUE,
  area: NEED_CAT_OR_TIME_VALUE,
  streamgraph: NEED_TIME_VALUE,
  scatter: NEED_TWO_QUANT,
  bubble: NEED_TWO_QUANT,
  histogram: NEED_ONE_QUANT,
  boxplot: NEED_ONE_QUANT,
  beeswarm: NEED_ONE_QUANT,
  ridgeline: NEED_CAT_VALUE,
  pie: NEED_CAT_VALUE,
  donut: NEED_CAT_VALUE,
  waffle: NEED_CAT_VALUE,
  funnel: NEED_CAT_VALUE,
  gauge: NEED_ONE_QUANT,
  table: ALWAYS,
  sankey: NEED_RELATION,
  chord: NEED_RELATION,
  network: NEED_RELATION,
  treemap: NEED_CAT_VALUE,
  circlepack: NEED_CAT_VALUE,
  sunburst: NEED_CAT_VALUE,
  marimekko: NEED_CAT_VALUE,
  slope: NEED_CAT_OR_TIME_VALUE,
  dumbbell: NEED_CAT_VALUE,
  barrace: NEED_TIME_VALUE,
  parliament: NEED_CAT_VALUE,
  parallel: NEED_TWO_QUANT,
  radar: NEED_CAT_VALUE,
  calendar: NEED_TIME_VALUE,
  gantt: NEED_TIME_VALUE,
  candlestick: NEED_TIME_VALUE,
  wordcloud: NEED_TEXT,
};

/**
 * Evaluate data compatibility for every catalog viz id.
 * Returns a map id → {compatible, score, reason}.
 *
 * `opts` lets the caller override the geo flags with the **committed** dataset
 * shape (the Struttura mapping) rather than the name-based profile guess — e.g.
 * after the operator designates lat/lon columns, point maps must light up even
 * when those columns aren't literally named "lat"/"lon".
 */
export function evaluateCompatibility(
  profile: DataProfile,
  geo: GeoResolution | null,
  opts: { hasGeoPoint?: boolean; hasGeoArea?: boolean } = {},
): Record<string, VizCompatibility> {
  const shape = shapeOf(profile, geo);
  if (opts.hasGeoPoint !== undefined) shape.hasGeoPoint = opts.hasGeoPoint;
  if (opts.hasGeoArea !== undefined) shape.hasGeoArea = opts.hasGeoArea;
  const out: Record<string, VizCompatibility> = {};
  for (const group of VIZ_GROUPS) {
    for (const item of group.items) {
      const rule = RULES[item.id] ?? ALWAYS;
      const r = rule(shape);
      out[item.id] = {
        id: item.id,
        compatible: r.ok,
        score: r.ok ? (r.score ?? 0.5) : 0,
        reason: r.ok ? undefined : r.reason,
      };
    }
  }
  return out;
}

/** Convenience: the set of compatible viz ids. */
export function compatibleVizIds(
  profile: DataProfile,
  geo: GeoResolution | null,
): Set<string> {
  const all = evaluateCompatibility(profile, geo);
  return new Set(Object.values(all).filter((c) => c.compatible).map((c) => c.id));
}
