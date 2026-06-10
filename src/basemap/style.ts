/**
 * Assemble a complete MapLibre GL style from a PMTiles archive + a Zornade
 * Studio flavor.
 *
 * Licensing note: the only mandatory credit for OSM-derived Protomaps tiles is
 * the OpenStreetMap attribution (ODbL). We bundle it together with the Zornade
 * credit. No CARTO / MapTiler / OpenMapTiles attribution is involved.
 *
 * Runtime note: the PMTiles protocol must be registered with MapLibre before a
 * style using `pmtiles://` is loaded, e.g.:
 *
 *   import { Protocol } from "pmtiles";
 *   import maplibregl from "maplibre-gl";
 *   const protocol = new Protocol();
 *   maplibregl.addProtocol("pmtiles", protocol.tile);
 */

import { type StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { type Flavor, layers } from "@protomaps/basemaps";

const OSM_ZORNADE_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' +
  ' · Dati e mappa: <a href="https://zornade.com" target="_blank" rel="noopener">Zornade</a>';

/** Default fonts/sprite endpoints. Self-host these on R2 for production. */
const DEFAULT_GLYPHS =
  "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf";
const DEFAULT_SPRITE =
  "https://protomaps.github.io/basemaps-assets/sprites/v4/light";

export interface BuildStyleOptions {
  /** HTTPS URL of the PMTiles archive on R2 (without the `pmtiles://` prefix). */
  tilesUrl: string;
  /** The flavor produced by `makeFlavor()`. */
  flavor: Flavor;
  /** BCP-47 language for labels. Default: "it". */
  lang?: string;
  /** Glyphs (fonts) endpoint. Default: Protomaps assets. Self-host for prod. */
  glyphsUrl?: string;
  /** Sprite base URL. Default: Protomaps light sprite. */
  spriteUrl?: string;
  /** Extra attribution appended after the mandatory OSM + Zornade credit. */
  attribution?: string;
  /**
   * Optional override for the map LABEL font. When provided, the style's
   * glyphs endpoint is switched to `glyphs` and every symbol layer's
   * `text-font` is remapped to this family (bold weights preserved).
   * When omitted, the default Protomaps Noto Sans is used unchanged.
   */
  mapFont?: { glyphs: string; regular: string; bold: string };
  /**
   * Render the basemap. When false, the style has no basemap source/layers and
   * the map background is transparent (only overlays like a choropleth show).
   * Default: true.
   */
  basemap?: boolean;
}

/** Heuristic: does this Protomaps text-font denote a heavier weight? */
const BOLD_RE = /medium|semibold|bold|black/i;

/** A Protomaps default font family name (the only thing we remap). */
const NOTO_RE = /^Noto Sans/i;

/**
 * Recursively remap every Protomaps `text-font` reference to the chosen family.
 *
 * `text-font` may be a plain string array (`["Noto Sans Regular"]`) OR a
 * MapLibre expression that embeds font names inside `["literal", [...]]`
 * (e.g. a zoom-dependent `case`). We deep-walk the value and replace only the
 * strings that look like a Noto font name, keeping the regular/bold distinction
 * and leaving expression keywords ("case", "get", "literal", …) untouched.
 */
function remapFontValue(value: unknown, font: { regular: string; bold: string }): unknown {
  if (typeof value === "string") {
    if (NOTO_RE.test(value)) return BOLD_RE.test(value) ? font.bold : font.regular;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => remapFontValue(v, font));
  }
  return value;
}

function applyMapFont<T extends { type?: string; layout?: Record<string, unknown> }>(
  styleLayers: T[],
  font: { regular: string; bold: string },
): T[] {
  return styleLayers.map((layer) => {
    if (layer.type !== "symbol" || !layer.layout) return layer;
    const current = layer.layout["text-font"];
    if (current == null) return layer;
    return {
      ...layer,
      layout: { ...layer.layout, "text-font": remapFontValue(current, font) },
    };
  });
}

/** Return a ready-to-use MapLibre `StyleSpecification`. */
export function buildStyle(opts: BuildStyleOptions): StyleSpecification {
  const lang = opts.lang ?? "it";
  const attribution = opts.attribution
    ? `${OSM_ZORNADE_ATTRIBUTION} · ${opts.attribution}`
    : OSM_ZORNADE_ATTRIBUTION;

  // Basemap-less style: no Protomaps source/layers → transparent background.
  // Only the Zornade credit is kept (no OSM tiles are shown, so the ODbL OSM
  // attribution is not required here).
  if (opts.basemap === false) {
    return {
      version: 8,
      glyphs: opts.mapFont?.glyphs ?? opts.glyphsUrl ?? DEFAULT_GLYPHS,
      sprite: opts.spriteUrl ?? DEFAULT_SPRITE,
      sources: {},
      layers: [],
    };
  }

  const baseLayers = layers("protomaps", opts.flavor, { lang });
  const styleLayers = opts.mapFont
    ? applyMapFont(baseLayers, opts.mapFont)
    : baseLayers;

  return {
    version: 8,
    glyphs: opts.mapFont?.glyphs ?? opts.glyphsUrl ?? DEFAULT_GLYPHS,
    sprite: opts.spriteUrl ?? DEFAULT_SPRITE,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${opts.tilesUrl}`,
        attribution,
      },
    },
    layers: styleLayers,
  };
}
