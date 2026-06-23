/**
 * Hexbin aggregation (O4.x maps) — pure, tested.
 *
 * Aggregates scattered points into a hexagonal grid and emits one polygon per
 * non-empty cell carrying `__value` (the count, or the summed weight). Used to
 * turn a dense point cloud into a readable density surface without deck.gl.
 *
 * Geometry: points are projected to a local planar frame (equirectangular with
 * a cos(lat0) correction at the dataset's mean latitude), binned on a pointy-top
 * hex lattice, then each cell centre + its 6 corners are projected back to
 * lng/lat. The cell size is derived from the data extent so the grid always
 * has a sensible resolution regardless of units.
 */

export interface HexPoint {
  lng: number;
  lat: number;
  /** Optional weight; when omitted each point counts as 1. */
  weight?: number;
}

export interface HexbinOptions {
  /** Target number of columns across the data width. Default 24. */
  targetCols?: number;
  /** Explicit hex size in km (overrides targetCols when set). */
  cellKm?: number;
}

export interface HexbinResult {
  geojson: GeoJSON.FeatureCollection;
  /** Per-cell aggregated values, for classification. */
  counts: number[];
  /** Max aggregated value (for legends/scaling). */
  max: number;
  /** Resolved hex size in km. */
  cellKm: number;
}

const DEG2RAD = Math.PI / 180;
const KM_PER_DEG_LAT = 110.574;

function meanLatExtent(points: HexPoint[]): {
  lat0: number;
  widthKm: number;
  heightKm: number;
} {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const p of points) {
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  const lat0 = (minLat + maxLat) / 2;
  const kmPerDegLng = KM_PER_DEG_LAT * Math.cos(lat0 * DEG2RAD);
  return {
    lat0,
    widthKm: (maxLng - minLng) * kmPerDegLng,
    heightKm: (maxLat - minLat) * KM_PER_DEG_LAT,
  };
}

/** Project lng/lat → local planar km (x east, y north) around lng0/lat0. */
function toKm(lng: number, lat: number, lng0: number, lat0: number): [number, number] {
  const kmPerDegLng = KM_PER_DEG_LAT * Math.cos(lat0 * DEG2RAD);
  return [(lng - lng0) * kmPerDegLng, (lat - lat0) * KM_PER_DEG_LAT];
}

/** Project local planar km → lng/lat. */
function toLngLat(x: number, y: number, lng0: number, lat0: number): [number, number] {
  const kmPerDegLng = KM_PER_DEG_LAT * Math.cos(lat0 * DEG2RAD);
  return [lng0 + x / kmPerDegLng, lat0 + y / KM_PER_DEG_LAT];
}

/**
 * Bin points into a pointy-top hex grid. Returns a FeatureCollection of hexagon
 * polygons (one per non-empty cell) with `__value` = count/summed weight.
 * Deterministic and side-effect free. Empty input → empty collection.
 */
export function hexbin(points: HexPoint[], opts: HexbinOptions = {}): HexbinResult {
  if (points.length === 0) {
    return { geojson: { type: "FeatureCollection", features: [] }, counts: [], max: 0, cellKm: 0 };
  }
  const ext = meanLatExtent(points);
  const targetCols = opts.targetCols ?? 24;
  // Hex "size" = centre-to-corner distance R (km). Column spacing for pointy-top
  // hexes is sqrt(3)*R; choose R so ~targetCols columns span the data width.
  const spanKm = Math.max(ext.widthKm, ext.heightKm, 1);
  const cellKm = opts.cellKm ?? Math.max(spanKm / targetCols / Math.sqrt(3), 0.001);
  const R = cellKm;

  const lng0 = points[0].lng;
  const lat0 = ext.lat0;

  // Pointy-top axial binning. width = sqrt(3)*R, height = 2*R, rows offset by
  // width/2 on odd rows. We invert by snapping to the nearest of the candidate
  // centres around the point.
  const W = Math.sqrt(3) * R;
  const H = 1.5 * R;

  const cells = new Map<string, { q: number; r: number; sum: number }>();
  for (const p of points) {
    const [x, y] = toKm(p.lng, p.lat, lng0, lat0);
    const r = Math.round(y / H);
    const xOffset = (r & 1) ? W / 2 : 0;
    const q = Math.round((x - xOffset) / W);
    const key = `${q}:${r}`;
    const w = p.weight ?? 1;
    const cell = cells.get(key);
    if (cell) cell.sum += w;
    else cells.set(key, { q, r, sum: w });
  }

  const counts: number[] = [];
  let max = 0;
  const features: GeoJSON.Feature[] = [];
  for (const { q, r, sum } of cells.values()) {
    const xOffset = (r & 1) ? W / 2 : 0;
    const cx = q * W + xOffset;
    const cy = r * H;
    const ring: number[][] = [];
    for (let i = 0; i < 6; i++) {
      // Pointy-top hex corners: angles at 30°, 90°, 150°, 210°, 270°, 330°.
      const ang = DEG2RAD * (60 * i - 90);
      const px = cx + R * Math.cos(ang);
      const py = cy + R * Math.sin(ang);
      ring.push(toLngLat(px, py, lng0, lat0));
    }
    ring.push(ring[0]);
    counts.push(sum);
    if (sum > max) max = sum;
    features.push({
      type: "Feature",
      properties: { __value: sum },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }

  return { geojson: { type: "FeatureCollection", features }, counts, max, cellKm };
}
