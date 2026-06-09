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
}

/** Return a ready-to-use MapLibre `StyleSpecification`. */
export function buildStyle(opts: BuildStyleOptions): StyleSpecification {
  const lang = opts.lang ?? "it";
  const attribution = opts.attribution
    ? `${OSM_ZORNADE_ATTRIBUTION} · ${opts.attribution}`
    : OSM_ZORNADE_ATTRIBUTION;

  return {
    version: 8,
    glyphs: opts.glyphsUrl ?? DEFAULT_GLYPHS,
    sprite: opts.spriteUrl ?? DEFAULT_SPRITE,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${opts.tilesUrl}`,
        attribution,
      },
    },
    layers: layers("protomaps", opts.flavor, { lang }),
  };
}
