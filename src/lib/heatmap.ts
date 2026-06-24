/**
 * Heatmap paint builder (O4.x maps) — pure, tested.
 *
 * Produces the MapLibre `heatmap` layer paint object from the data's value
 * range and the chosen colour ramp. The density weight is driven by the value
 * column (normalised 0..1) when present, else every point counts as 1. Radius
 * and intensity grow with zoom so the heatmap stays readable across scales.
 */

import { BRAND_TEAL } from "../studio/palettes";

export interface HeatmapPaintOptions {
  /** Numeric range of the weighting value, when a value column is set. */
  valueRange?: { min: number; max: number };
  /** Colour ramp (light→dark); the first stop is forced transparent. */
  colors: string[];
  /** Base radius in px (at low zoom). Default 18. */
  radius?: number;
  /** Base intensity. Default 0.9. */
  intensity?: number;
  /** Layer opacity. Default 0.85. */
  opacity?: number;
}

/**
 * Build the `heatmap` paint. The `heatmap-color` ramp interpolates the given
 * colours across density 0..1, starting transparent so empty areas show the
 * basemap. The `heatmap-weight` reads `__value` scaled into 0..1 when a value
 * range is supplied; otherwise it is a constant 1 (pure point density).
 */
export function buildHeatmapPaint(opts: HeatmapPaintOptions): Record<string, unknown> {
  const colors = opts.colors.length > 0 ? opts.colors : [BRAND_TEAL];
  const radius = opts.radius ?? 18;
  const intensity = opts.intensity ?? 0.9;
  const opacity = opts.opacity ?? 0.85;

  // Density → colour ramp. Stop 0 is transparent; the rest spread the palette.
  const color: unknown[] = [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    0,
    "rgba(0,0,0,0)",
  ];
  const n = colors.length;
  for (let i = 0; i < n; i++) {
    const stop = n === 1 ? 1 : 0.1 + (0.9 * i) / (n - 1);
    color.push(Number(stop.toFixed(3)), colors[i]);
  }

  // Weight from the value column, normalised to 0..1; constant 1 otherwise.
  let weight: unknown = 1;
  if (opts.valueRange && opts.valueRange.max > opts.valueRange.min) {
    const { min, max } = opts.valueRange;
    weight = [
      "interpolate",
      ["linear"],
      ["coalesce", ["get", "__value"], min],
      min,
      0.1,
      max,
      1,
    ];
  }

  return {
    "heatmap-weight": weight,
    "heatmap-intensity": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      intensity,
      9,
      intensity * 3,
    ],
    "heatmap-color": color,
    "heatmap-radius": [
      "interpolate",
      ["linear"],
      ["zoom"],
      0,
      radius,
      9,
      radius * 2.2,
    ],
    "heatmap-opacity": opacity,
  };
}
