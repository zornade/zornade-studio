/**
 * Cartogram geometry (O4 maps) — pure, tested.
 *
 * Two honest, deterministic variants (the contiguous Gastner–Newman cartogram
 * is research-grade and has no mature permissive library, so it is out of scope):
 *
 *  - **non-contiguous**: each area polygon is scaled around its own centroid so
 *    its area becomes proportional to the value (linear factor = √(value/max)).
 *    Areas keep their position and shape; bigger value → bigger polygon.
 *  - **Dorling**: each area becomes a circle sized by value, positioned near its
 *    centroid and relaxed apart so circles don't overlap.
 *
 * Both consume features that already carry a numeric `__value` (mirroring the
 * choropleth join), and emit a FeatureCollection ready for the existing fill
 * paint (coloured by value) — the editor and the embed render them the same way.
 */

import { featureCentroid } from "./centroid";

export type CartogramKind = "noncontiguous" | "dorling";

const DEG2RAD = Math.PI / 180;
const KM_PER_DEG_LAT = 110.574;

/** Max numeric `__value` across features (0 when none). */
function maxValue(features: GeoJSON.Feature[]): number {
  let m = 0;
  for (const f of features) {
    const v = (f.properties as Record<string, unknown>)?.__value;
    if (typeof v === "number" && v > m) m = v;
  }
  return m;
}

/** Scale a [lng,lat] around a centroid by a linear factor. */
function scalePt(
  pt: number[],
  cx: number,
  cy: number,
  factor: number,
): [number, number] {
  return [cx + (pt[0] - cx) * factor, cy + (pt[1] - cy) * factor];
}

/** Scale every coordinate of a Polygon/MultiPolygon around (cx,cy). */
function scalePolygonGeometry(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  cx: number,
  cy: number,
  factor: number,
): GeoJSON.Polygon | GeoJSON.MultiPolygon {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) =>
        ring.map((pt) => scalePt(pt, cx, cy, factor)),
      ),
    };
  }
  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((poly) =>
      poly.map((ring) => ring.map((pt) => scalePt(pt, cx, cy, factor))),
    ),
  };
}

/**
 * Non-contiguous cartogram: scale each valued area around its centroid so the
 * rendered area is proportional to the value. Features without a numeric value
 * (or non-polygon) pass through unchanged. Deterministic and side-effect free.
 */
export function nonContiguousCartogram(
  features: GeoJSON.Feature[],
): GeoJSON.FeatureCollection {
  const max = maxValue(features);
  const out: GeoJSON.Feature[] = features.map((f) => {
    const props = (f.properties as Record<string, unknown>) ?? {};
    const v = props.__value;
    const g = f.geometry;
    if (
      typeof v !== "number" ||
      max <= 0 ||
      !g ||
      (g.type !== "Polygon" && g.type !== "MultiPolygon")
    ) {
      return f;
    }
    const c = featureCentroid(g);
    if (!c) return f;
    // Linear factor = √(value/max): area (∝ factor²) becomes ∝ value. Clamp a
    // floor so tiny values stay faintly visible rather than vanishing.
    const factor = Math.max(0.08, Math.sqrt(v / max));
    return {
      ...f,
      geometry: scalePolygonGeometry(
        g as GeoJSON.Polygon | GeoJSON.MultiPolygon,
        c[0],
        c[1],
        factor,
      ),
    };
  });
  return { type: "FeatureCollection", features: out };
}

export interface DorlingInput {
  lng: number;
  lat: number;
  value: number;
  name?: string;
  /** Extra props to carry onto the output circle (e.g. category). */
  extra?: Record<string, unknown>;
}

export interface DorlingOptions {
  /** Radius (km) of the largest-value circle. Default 45. */
  maxRadiusKm?: number;
  /** Relaxation iterations. Default 60. */
  iterations?: number;
  /** Min radius (km) so tiny values stay visible. Default 2. */
  minRadiusKm?: number;
}

/** Build a circle polygon ring (closed) of `radiusKm` around lng/lat. */
function circleRingKm(
  lng: number,
  lat: number,
  radiusKm: number,
  steps = 48,
): number[][] {
  const ring: number[][] = [];
  const kmPerDegLng = KM_PER_DEG_LAT * Math.cos(lat * DEG2RAD) || KM_PER_DEG_LAT;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const dx = (radiusKm * Math.cos(a)) / kmPerDegLng;
    const dy = (radiusKm * Math.sin(a)) / KM_PER_DEG_LAT;
    ring.push([lng + dx, lat + dy]);
  }
  return ring;
}

/**
 * Dorling cartogram: one circle per area, radius ∝ √value, positioned near the
 * area centroid and relaxed apart so circles don't overlap. Returns a
 * FeatureCollection of circle polygons carrying `__value`/`__name`.
 *
 * The relaxation runs in a local planar km frame (cos-lat corrected at the mean
 * latitude). It is O(n²) per iteration, intended for coarse levels (regioni/
 * province); above {@link RELAX_MAX} features the relaxation is skipped (circles
 * sit on their centroids) to stay fast.
 */
const RELAX_MAX = 1200;
export function dorlingCartogram(
  inputs: DorlingInput[],
  opts: DorlingOptions = {},
): GeoJSON.FeatureCollection {
  const valid = inputs.filter((d) => Number.isFinite(d.value) && d.value > 0);
  if (valid.length === 0) return { type: "FeatureCollection", features: [] };

  const maxRadius = opts.maxRadiusKm ?? 45;
  const minRadius = opts.minRadiusKm ?? 2;
  const iterations = opts.iterations ?? 60;
  const max = valid.reduce((m, d) => Math.max(m, d.value), 0);

  // Mean latitude for the local planar projection.
  const lat0 = valid.reduce((s, d) => s + d.lat, 0) / valid.length;
  const kmPerDegLng = KM_PER_DEG_LAT * Math.cos(lat0 * DEG2RAD) || KM_PER_DEG_LAT;

  // Nodes in km space, with their home (anchor) position.
  const nodes = valid.map((d) => {
    const x = d.lng * kmPerDegLng;
    const y = d.lat * KM_PER_DEG_LAT;
    const r = Math.max(minRadius, Math.sqrt(d.value / max) * maxRadius);
    return { x, y, hx: x, hy: y, r, d };
  });

  if (nodes.length <= RELAX_MAX) {
    for (let iter = 0; iter < iterations; iter++) {
      // Pairwise repulsion when circles overlap.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy);
          const minDist = a.r + b.r;
          if (dist === 0) {
            // Coincident: nudge deterministically.
            dx = (i - j) || 1;
            dy = 1;
            dist = Math.hypot(dx, dy);
          }
          if (dist < minDist) {
            const push = (minDist - dist) / 2;
            const ux = dx / dist;
            const uy = dy / dist;
            a.x -= ux * push;
            a.y -= uy * push;
            b.x += ux * push;
            b.y += uy * push;
          }
        }
      }
      // Weak pull back toward home so circles stay near their real position.
      for (const n of nodes) {
        n.x += (n.hx - n.x) * 0.02;
        n.y += (n.hy - n.y) * 0.02;
      }
    }
  }

  const features: GeoJSON.Feature[] = nodes.map((n) => {
    const lng = n.x / kmPerDegLng;
    const lat = n.y / KM_PER_DEG_LAT;
    const props: Record<string, unknown> = { __value: n.d.value, ...(n.d.extra ?? {}) };
    if (n.d.name != null) props.__name = n.d.name;
    return {
      type: "Feature",
      properties: props,
      geometry: { type: "Polygon", coordinates: [circleRingKm(lng, lat, n.r)] },
    };
  });
  return { type: "FeatureCollection", features };
}
