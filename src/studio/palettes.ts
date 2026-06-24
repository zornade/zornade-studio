/**
 * Canonical colour scales and basemaps for choropleth/symbol layers.
 *
 * This module is **React-free on purpose**: it is the single source of truth
 * for palettes and basemap style URLs, imported both by the editor UI
 * (via catalog.tsx, which re-exports it) and by the dependency-light embed
 * generator + Netlify publish function. Keeping it free of JSX/React means the
 * publish function never pulls the UI bundle.
 */

import type { StyleSpecification } from "maplibre-gl";
import { buildRasterStyle } from "../lib/raster";

/** Data color scales for choropleth/symbol layers. */
export interface ColorScale {
  id: string;
  label: string;
  type: "sequenziale" | "divergente" | "categorica";
  colors: string[];
  /**
   * True when the palette is designed to stay distinguishable under colour
   * vision deficiency (verified against published colour-blind-safe palettes).
   */
  cvdSafe?: boolean;
}

export const COLOR_SCALES: ColorScale[] = [
  // Single-hue sequential ramps vary mainly in lightness → CVD-robust.
  { id: "teal-seq", label: "Teal", type: "sequenziale", colors: ["#e6f5f6", "#9ad6db", "#32a4ae", "#01646f"], cvdSafe: true },
  { id: "blue-seq", label: "Blu", type: "sequenziale", colors: ["#eaf2fb", "#9ec5e8", "#4a90d9", "#1b4f8a"], cvdSafe: true },
  { id: "warm-seq", label: "Caldo", type: "sequenziale", colors: ["#fff3e0", "#ffb74d", "#f57c00", "#bf360c"], cvdSafe: true },
  // Viridis — perceptually uniform, colour-blind-safe (matplotlib, CC0/public domain).
  { id: "viridis", label: "Viridis", type: "sequenziale", colors: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"], cvdSafe: true },
  // Magma — perceptually uniform, colour-blind-safe (matplotlib, CC0/public domain).
  { id: "magma", label: "Magma", type: "sequenziale", colors: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"], cvdSafe: true },
  // ColorBrewer YlGnBu — sequential, colour-blind-safe (Apache-2.0, © Cynthia Brewer).
  { id: "ylgnbu", label: "Giallo–Verde–Blu", type: "sequenziale", colors: ["#ffffcc", "#a1dab4", "#41b6c4", "#2c7fb8", "#253494"], cvdSafe: true },
  // ColorBrewer RdBu / PuOr — diverging, colour-blind-safe.
  { id: "div-rdbu", label: "Rosso–Blu", type: "divergente", colors: ["#b2182b", "#f4a582", "#f7f7f7", "#92c5de", "#2166ac"], cvdSafe: true },
  { id: "puor", label: "Viola–Arancio", type: "divergente", colors: ["#e66101", "#fdb863", "#f7f7f7", "#b2abd2", "#5e3c99"], cvdSafe: true },
  // ColorBrewer BrBG — diverging, colour-blind-safe (Apache-2.0, © Cynthia Brewer).
  { id: "brbg", label: "Marrone–Verde", type: "divergente", colors: ["#a6611a", "#dfc27d", "#f5f5f5", "#80cdc1", "#018571"], cvdSafe: true },
  // Okabe–Ito — the standard colour-blind-safe qualitative palette.
  { id: "okabe", label: "Categorica (daltonismo)", type: "categorica", colors: ["#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00", "#cc79a7"], cvdSafe: true },
  // Generic categorical (not CVD-verified — the check flags its red/green pair).
  { id: "cat", label: "Categorica", type: "categorica", colors: ["#32a4ae", "#f57c00", "#7e57c2", "#43a047", "#e53935"] },
];

/**
 * Basemap choices. OpenFreeMap styles work with NO API key, no usage limits and
 * allow commercial use (MIT; data © OpenMapTiles / OpenStreetMap, attribution
 * auto-added by MapLibre). "none" renders the data on a transparent background.
 * "custom" (a 100% Zornade self-hosted basemap) is on the roadmap.
 */
export interface MapBasemap {
  id: string;
  label: string;
  /** External MapLibre style URL, or null for "no basemap" / "soon" / raster. */
  styleUrl: string | null;
  /** Raster tile URL template (XYZ/WMS) when this basemap is a raster layer. */
  rasterUrl?: string;
  /** Attribution for a raster basemap. */
  attribution?: string;
  status?: "ready" | "soon";
}

const OFM = "https://tiles.openfreemap.org/styles";

export const MAP_BASEMAPS: MapBasemap[] = [
  { id: "ofm-positron", label: "Chiaro (Positron)", styleUrl: `${OFM}/positron` },
  { id: "ofm-bright", label: "Standard (Bright)", styleUrl: `${OFM}/bright` },
  { id: "ofm-liberty", label: "Dettagliato (Liberty)", styleUrl: `${OFM}/liberty` },
  { id: "ofm-dark", label: "Scuro (Dark)", styleUrl: `${OFM}/dark` },
  {
    id: "sat-esri",
    label: "Satellite (Esri)",
    styleUrl: null,
    rasterUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
  {
    id: "custom-raster",
    label: "Raster / WMS personalizzato",
    styleUrl: null,
    rasterUrl: "",
  },
  { id: "none", label: "Nessuna (sfondo trasparente)", styleUrl: null },
  { id: "custom", label: "Custom", styleUrl: null, status: "soon" },
];

/** Colours of a scale by id, falling back to the first scale if unknown.
 * Pass `reverse` to flip the ramp direction (e.g. dark→light). */
export function colorsForScale(id: string, reverse = false): string[] {
  const colors = (COLOR_SCALES.find((s) => s.id === id) ?? COLOR_SCALES[0]).colors;
  return reverse ? [...colors].reverse() : colors;
}

/** MapLibre style URL for a basemap id, or null for "none"/"custom"/unknown. */
export function basemapStyleUrl(id: string): string | null {
  return MAP_BASEMAPS.find((b) => b.id === id)?.styleUrl ?? null;
}

/**
 * Resolve a basemap id to what MapLibre's `setStyle` needs: a vector style URL
 * (string), a raster style object (satellite/WMS), or null for "none". For a
 * raster basemap, `customUrl` overrides the preset's URL (the "custom-raster"
 * option supplies it). Returns null when a raster URL is missing/invalid.
 */
export function resolveBasemap(
  id: string,
  customUrl = "",
): string | StyleSpecification | null {
  const def = MAP_BASEMAPS.find((b) => b.id === id);
  if (!def) return null;
  if (def.styleUrl) return def.styleUrl;
  if (def.rasterUrl !== undefined) {
    const url = (def.id === "custom-raster" ? customUrl : def.rasterUrl).trim();
    if (!url) return null;
    return buildRasterStyle(url, { attribution: def.attribution });
  }
  return null;
}
