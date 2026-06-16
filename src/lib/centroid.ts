/**
 * Polygon centroid computation (ROADMAP O2.6 — proportional symbol maps).
 *
 * A symbol map places a sized bubble at each area's representative point. We
 * use the area-weighted centroid of the polygon's largest ring, which sits
 * inside compact shapes and is stable/deterministic. For MultiPolygon we pick
 * the ring with the greatest absolute area (e.g. mainland over small islands),
 * so the bubble lands on the body of the region rather than between parts.
 */

type Ring = number[][]; // [ [lon,lat], ... ]

/** Signed area (×2) of a ring via the shoelace formula. */
function ringArea2(ring: Ring): number {
  let a = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a;
}

/** Area-weighted centroid of a single ring. Falls back to the vertex mean for
 * degenerate (zero-area) rings. */
function ringCentroid(ring: Ring): [number, number] {
  const a2 = ringArea2(ring);
  if (a2 === 0) {
    // Degenerate ring: average the vertices.
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    const n = ring.length || 1;
    return [sx / n, sy / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  return [cx / (3 * a2), cy / (3 * a2)];
}

/**
 * Representative point [lon, lat] for a GeoJSON geometry, or null when there is
 * no usable polygon. Points/MultiPoints return their (first) coordinate.
 */
export function featureCentroid(
  geometry: GeoJSON.Geometry | null,
): [number, number] | null {
  if (!geometry) return null;
  switch (geometry.type) {
    case "Point":
      return geometry.coordinates as [number, number];
    case "MultiPoint":
      return (geometry.coordinates[0] as [number, number]) ?? null;
    case "Polygon": {
      const outer = geometry.coordinates[0] as Ring | undefined;
      return outer && outer.length ? ringCentroid(outer) : null;
    }
    case "MultiPolygon": {
      // Pick the polygon with the largest outer-ring area.
      let best: Ring | null = null;
      let bestArea = -1;
      for (const poly of geometry.coordinates) {
        const outer = poly[0] as Ring | undefined;
        if (!outer || !outer.length) continue;
        const area = Math.abs(ringArea2(outer));
        if (area > bestArea) {
          bestArea = area;
          best = outer;
        }
      }
      return best ? ringCentroid(best) : null;
    }
    default:
      return null;
  }
}
