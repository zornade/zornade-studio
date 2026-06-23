/**
 * Spike map geometry (O4.x maps) — pure, tested.
 *
 * A spike map draws a thin triangle ("spike") at each area's representative
 * point, its height proportional to the value. The triangle is built in
 * geographic space: the base is a short horizontal segment centred on the
 * point, the apex sits north of it by a value-proportional latitude delta.
 * Width is corrected by cos(lat) so spikes look symmetric at Italian latitudes.
 *
 * Output is a FeatureCollection of triangle polygons carrying `__value` and
 * `__name`, so the existing fill layer + tooltip render them unchanged.
 */

export interface SpikeInput {
  lng: number;
  lat: number;
  value: number;
  name?: string;
}

export interface SpikeOptions {
  /** Value mapped to the tallest spike (usually the max of the data). */
  maxValue: number;
  /** Height of the tallest spike, in degrees of latitude. Default 1.6°. */
  maxHeightDeg?: number;
  /** Half-width of the spike base, in degrees (cos-lat corrected). Default 0.14°. */
  halfWidthDeg?: number;
}

const DEG2RAD = Math.PI / 180;

/**
 * Build spike triangles for the given points. Spikes are emitted tallest-first
 * (descending value) so shorter spikes draw on top and stay visible; zero/
 * negative values are skipped. Deterministic and side-effect free.
 */
export function spikeTriangles(
  points: SpikeInput[],
  opts: SpikeOptions,
): GeoJSON.FeatureCollection {
  const maxHeight = opts.maxHeightDeg ?? 1.6;
  const halfWidth = opts.halfWidthDeg ?? 0.14;
  const maxValue = opts.maxValue > 0 ? opts.maxValue : 1;

  const sorted = [...points]
    .filter((p) => Number.isFinite(p.value) && p.value > 0)
    .sort((a, b) => b.value - a.value);

  const features: GeoJSON.Feature[] = sorted.map((p) => {
    const h = (p.value / maxValue) * maxHeight;
    // Correct the half-width for longitude compression at this latitude so the
    // base looks the same visual width north-to-south.
    const w = halfWidth / Math.max(0.2, Math.cos(p.lat * DEG2RAD));
    const ring: number[][] = [
      [p.lng - w, p.lat],
      [p.lng + w, p.lat],
      [p.lng, p.lat + h],
      [p.lng - w, p.lat],
    ];
    const properties: Record<string, unknown> = { __value: p.value };
    if (p.name != null) properties.__name = p.name;
    return {
      type: "Feature",
      properties,
      geometry: { type: "Polygon", coordinates: [ring] },
    };
  });

  return { type: "FeatureCollection", features };
}
