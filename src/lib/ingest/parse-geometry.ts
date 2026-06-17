/**
 * Readers for user-supplied **geometry** files (ROADMAP O2.3b): Shapefile
 * (`.zip` bundle or bare `.shp`), KML, KMZ. Each returns a normalised WGS84
 * GeoJSON FeatureCollection, which {@link buildGeoDataset} turns into a
 * GeoDataset. Output geometry is drawn directly on the map.
 *
 * The parsing libraries are **lazy-imported** so they stay out of the initial
 * bundle (only loaded when the user actually drops a geometry file):
 *  - `shpjs` (MIT) — shapefile → GeoJSON, **reprojecting** via proj4 (Italian
 *    shapefiles are usually in Gauss-Boaga/UTM, not lon/lat).
 *  - `@tmcw/togeojson` (BSD-2) — KML → GeoJSON, using the browser DOMParser.
 *  - `fflate` (MIT) — unzip a KMZ (a zip whose payload is a `.kml`).
 */

/** Merge one-or-more shapefile layers into a single FeatureCollection. */
function mergeLayers(
  fc: GeoJSON.FeatureCollection | GeoJSON.FeatureCollection[],
): GeoJSON.FeatureCollection {
  const layers = Array.isArray(fc) ? fc : [fc];
  const features: GeoJSON.Feature[] = [];
  for (const layer of layers) {
    if (layer && Array.isArray(layer.features)) features.push(...layer.features);
  }
  return { type: "FeatureCollection", features };
}

/**
 * Parse a shapefile from an ArrayBuffer. A `.zip` bundle (shp+dbf+prj) is the
 * normal case and keeps attributes + projection; a bare `.shp` yields geometry
 * only (no attributes), still useful as a context layer.
 */
export async function parseShapefile(
  buffer: ArrayBuffer,
  isZip: boolean,
): Promise<GeoJSON.FeatureCollection> {
  const shp = await import("shpjs");
  if (isZip) {
    const fc = await shp.parseZip(buffer);
    return mergeLayers(fc);
  }
  // Bare .shp: geometry only, wrapped as featureless features.
  const geometries = shp.parseShp(buffer);
  return {
    type: "FeatureCollection",
    features: geometries.map((g) => ({
      type: "Feature",
      properties: {},
      geometry: g as GeoJSON.Geometry,
    })),
  };
}

/** Parse KML text into a FeatureCollection (uses the browser DOMParser). */
export async function parseKml(text: string): Promise<GeoJSON.FeatureCollection> {
  const { kml } = await import("@tmcw/togeojson");
  const doc = new DOMParser().parseFromString(text, "text/xml");
  // A parse error yields a <parsererror> root rather than throwing.
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Il file KML non è valido.");
  }
  return kml(doc) as GeoJSON.FeatureCollection;
}

/** Parse a KMZ (zip → first .kml entry → KML). */
export async function parseKmz(
  buffer: ArrayBuffer,
): Promise<GeoJSON.FeatureCollection> {
  const { unzipSync } = await import("fflate");
  const entries = unzipSync(new Uint8Array(buffer));
  // Prefer doc.kml; otherwise the first .kml in the archive.
  const name =
    Object.keys(entries).find((n) => n.toLowerCase() === "doc.kml") ??
    Object.keys(entries).find((n) => n.toLowerCase().endsWith(".kml"));
  if (!name) throw new Error("Il KMZ non contiene un file KML.");
  const text = new TextDecoder("utf-8").decode(entries[name]);
  return parseKml(text);
}
