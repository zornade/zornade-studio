/**
 * Raster basemap helpers (O4 maps) - pure, tested.
 *
 * Builds a MapLibre raster `StyleSpecification` from a tile URL template, so a
 * satellite/aerial or any external XYZ/WMS layer can be used as the map
 * background. The data layers are added on top by the renderer, so a raster
 * basemap works for every viz type. No new dependencies.
 *
 * MapLibre substitutes the named placeholders `{x}`/`{y}`/`{z}` wherever they
 * appear (so WMTS `…/{z}/{y}/{x}` templates work too) and `{bbox-epsg-3857}`
 * for WMS GetMap requests in Web-Mercator.
 */

import type { StyleSpecification } from "maplibre-gl";

export type RasterUrlKind = "xyz" | "wms" | "invalid";

/**
 * Classify a raster tile URL template:
 *  - `xyz`  - has `{z}`, `{x}` and `{y}` placeholders (XYZ/WMTS tiles);
 *  - `wms`  - has a `{bbox-epsg-3857}` placeholder (WMS GetMap, Web-Mercator);
 *  - `invalid` - neither (can't be used as a tile template).
 */
export function classifyRasterUrl(url: string): RasterUrlKind {
  const u = url.trim();
  if (/\{z\}/.test(u) && /\{x\}/.test(u) && /\{y\}/.test(u)) return "xyz";
  if (/\{bbox-epsg-3857\}/i.test(u)) return "wms";
  return "invalid";
}

export interface RasterStyleOptions {
  attribution?: string;
  /** Tile size in px. WMS GetMap usually 256; some services use 512. Default 256. */
  tileSize?: number;
  maxzoom?: number;
}

/**
 * Build a MapLibre raster style (one raster source + layer) from a tile URL
 * template. Returns null when the URL is not a usable XYZ/WMS template.
 */
export function buildRasterStyle(
  url: string,
  opts: RasterStyleOptions = {},
): StyleSpecification | null {
  if (classifyRasterUrl(url) === "invalid") return null;
  return {
    version: 8,
    sources: {
      "raster-bg": {
        type: "raster",
        tiles: [url.trim()],
        tileSize: opts.tileSize ?? 256,
        ...(opts.maxzoom != null ? { maxzoom: opts.maxzoom } : {}),
        ...(opts.attribution ? { attribution: opts.attribution } : {}),
      },
    },
    layers: [
      { id: "raster-bg", type: "raster", source: "raster-bg" },
    ],
  } as StyleSpecification;
}

/**
 * Standalone "rilievo" basemap: a free DEM (Tilezen / AWS Open Data, terrarium
 * encoding) rendered as a soft hypsometric color-relief tint plus a
 * multidirectional hillshade on top. No vector tiles, no API key. Hillshade
 * uses the multidirectional method (MapLibre 5.5+) and color-relief is a
 * dedicated layer type (MapLibre 5.6+) — both unlocked by 5.24. The data
 * layers and labels are drawn above this by the renderer.
 */
export function buildReliefStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      dem: {
        type: "raster-dem",
        tiles: [
          "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png",
        ],
        encoding: "terrarium",
        tileSize: 256,
        maxzoom: 13,
        attribution:
          "DEM © Tilezen / Mapzen · AWS Open Data · NASA SRTM",
      },
    },
    layers: [
      { id: "relief-bg", type: "background", paint: { "background-color": "#eef3f7" } },
      {
        id: "color-relief",
        type: "color-relief",
        source: "dem",
        paint: {
          "color-relief-opacity": 0.6,
          "color-relief-color": [
            "interpolate",
            ["linear"],
            ["elevation"],
            0, "#c8e0c8",
            200, "#e6e2bf",
            600, "#d9c39a",
            1200, "#bfa17a",
            2000, "#a98b6f",
            3000, "#f2f2f2",
          ],
        },
      },
      {
        id: "hillshade",
        type: "hillshade",
        source: "dem",
        paint: {
          "hillshade-method": "multidirectional",
          "hillshade-exaggeration": 0.5,
          "hillshade-shadow-color": "#4a4a4a",
          "hillshade-highlight-color": "#ffffff",
        },
      },
    ],
  } as unknown as StyleSpecification;
}

