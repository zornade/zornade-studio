/**
 * Pure GeoJSON bounding-box helpers shared by the map editor.
 *
 * These walk raw GeoJSON coordinate arrays without touching MapLibre or the
 * DOM, so they are deterministic and unit-testable in isolation.
 */

/**
 * Bounding-box centre of a single GeoJSON geometry, used to anchor the
 * 3D-extrusion tooltip to a feature's footprint (the raw event `lngLat` is the
 * ground point under the cursor, which drifts far from a tall bar when the map
 * is pitched). Returns null for empty/coordinate-less geometries.
 */
export function featureCenter(
  geom: GeoJSON.Geometry | null | undefined,
): [number, number] | null {
  if (!geom || !("coordinates" in geom)) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else if (Array.isArray(c)) {
      for (const child of c) visit(child);
    }
  };
  visit((geom as { coordinates: unknown }).coordinates);
  if (!Number.isFinite(minX)) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/**
 * Compute the bounding box of the features that carry a numeric `__value`
 * (i.e. the data the user actually mapped), falling back to all features.
 * Handles Polygon / MultiPolygon / Point geometries. Returns null if empty.
 */
export function computeBounds(
  geojson: GeoJSON.FeatureCollection,
): [[number, number], [number, number]] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const visit = (lng: number, lat: number) => {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  };

  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (
      coords.length >= 2 &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number"
    ) {
      visit(coords[0], coords[1]);
      return;
    }
    for (const c of coords) walk(c);
  };

  const withValue = geojson.features.filter(
    (f) =>
      typeof (f.properties as Record<string, unknown>)?.__value === "number",
  );
  const features = withValue.length > 0 ? withValue : geojson.features;
  for (const f of features) {
    if (f.geometry && "coordinates" in f.geometry) {
      walk((f.geometry as { coordinates: unknown }).coordinates);
    }
  }

  if (!Number.isFinite(minLng) || !Number.isFinite(maxLng)) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
