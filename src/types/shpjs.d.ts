/**
 * Minimal type declarations for `shpjs` 6.2.0 (ships no types, no @types).
 * We only declare the two entry points we use to parse uploaded files in the
 * browser: `parseZip` (a zipped shapefile bundle) and `parseShp` (a bare .shp
 * geometry stream). Both return GeoJSON; `parseZip` may return several layers.
 */
declare module "shpjs" {
  import type { FeatureCollection, Geometry } from "geojson";

  /** Parse a zipped shapefile (ArrayBuffer of a .zip) → one or more layers. */
  export function parseZip(
    buffer: ArrayBuffer,
    whiteList?: string[],
  ): Promise<FeatureCollection | FeatureCollection[]>;

  /** Parse a bare .shp geometry buffer → an array of geometries. */
  export function parseShp(
    buffer: ArrayBuffer,
    prj?: string | false,
  ): Geometry[];

  const getShapefile: (
    base: string,
    whiteList?: string[],
  ) => Promise<FeatureCollection | FeatureCollection[]>;
  export default getShapefile;
}
