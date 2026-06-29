/**
 * User-supplied geometry → a ready {@link GeoDataset} (ROADMAP O2.3b).
 *
 * Unlike the choropleth path (which joins a table to *bundled* geometry), here
 * the geometry **is** the payload: the user uploads a Shapefile, KML/KMZ or a
 * GeoJSON whose features carry their own shapes (neighbourhoods, electoral
 * districts, catchments…). We mirror each feature's `properties` into a table
 * (so the data panel and profiling work as usual) and remember which geometry
 * primitives are present, so the renderer can draw polygons, lines and points
 * with the right layers. If a numeric property is chosen, polygons are coloured
 * by value - a choropleth on the user's **own** geometry.
 *
 * This module is pure (no parser/library imports) and unit-tested. The format
 * readers (shapefile/KML/KMZ) live in `lib/ingest/parse-geometry.ts` and feed a
 * normalised GeoJSON FeatureCollection in here.
 */

import type { GeoDataset, GeometryKind } from "../studio/types";
import { detectNumericColumns, parseNumber } from "./csv";
import { profileColumns } from "./profile";

/** Column names that look like a human label for tooltips/legends. */
const NAME_HINT =
  /^(nome|name|denominazione|denom|comune|localita|località|toponimo|label|titolo|title|descrizione|desc|quartiere|zona_nome)$/i;

/** Map a GeoJSON geometry type to one of our three render primitives. */
function geometryKindOf(type: string | undefined): GeometryKind | null {
  switch (type) {
    case "Polygon":
    case "MultiPolygon":
      return "polygon";
    case "LineString":
    case "MultiLineString":
      return "line";
    case "Point":
    case "MultiPoint":
      return "point";
    default:
      return null; // GeometryCollection / unknown → ignored for layering
  }
}

/** Distinct geometry primitives present, in polygon→line→point order. */
export function geometryKinds(fc: GeoJSON.FeatureCollection): GeometryKind[] {
  const present = new Set<GeometryKind>();
  for (const f of fc.features) {
    const k = geometryKindOf(f.geometry?.type);
    if (k) present.add(k);
  }
  return (["polygon", "line", "point"] as GeometryKind[]).filter((k) =>
    present.has(k),
  );
}

/**
 * Does this parsed JSON contain its own **polygon or line** geometry worth
 * drawing directly? Used to decide whether an uploaded GeoJSON is the user's
 * own geometry (→ geo dataset) or a tabular file to join to bundled geometry.
 * Point-only collections stay on the existing tabular/point path, which offers
 * size/category styling.
 */
export function hasDrawableGeometry(json: unknown): boolean {
  const features: unknown[] = Array.isArray(
    (json as { features?: unknown }).features,
  )
    ? (json as { features: unknown[] }).features
    : (json as { type?: string }).type === "Feature"
      ? [json]
      : [];
  for (const f of features) {
    const type = (f as { geometry?: { type?: string } }).geometry?.type;
    const kind = geometryKindOf(type);
    if (kind === "polygon" || kind === "line") return true;
  }
  return false;
}

/** Stringify a property value the way the rest of the pipeline expects. */
function stringifyCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Build a GeoDataset from a (reprojected, WGS84) FeatureCollection. Returns a
 * human error message when there is no usable geometry.
 */
export function buildGeoDataset(
  fc: GeoJSON.FeatureCollection,
  fileName: string,
): { dataset: GeoDataset } | { error: string } {
  const features = (fc.features ?? []).filter(
    (f) => f && f.geometry && geometryKindOf(f.geometry.type) !== null,
  );
  if (features.length === 0) {
    return {
      error: "Il file non contiene geometrie riconoscibili (aree, linee o punti).",
    };
  }

  // Columns = union of property keys (first-seen order); rows = stringified.
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(props)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  const rows = features.map((f) => {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const row: Record<string, string> = {};
    for (const col of columns) row[col] = stringifyCell(props[col]);
    return row;
  });

  const kinds = geometryKinds({ type: "FeatureCollection", features });
  const numericColumns =
    columns.length > 0 ? detectNumericColumns(columns, rows) : [];

  // Default bindings:
  //  - value  → first numeric column (colours polygons)
  //  - name   → a column that looks like a label (by name hint), else the
  //             first identifier/text column
  //  - category → first categorical column that isn't the name/value
  // The name hint is more robust than profiling on the few features a custom
  // boundary file often has (where "nome" and "zona" are both categorical).
  const profile =
    columns.length > 0
      ? profileColumns(columns, rows)
      : { columns: [] as { name: string; type: string }[] };

  const nameColumn =
    columns.find((c) => NAME_HINT.test(c)) ??
    profile.columns.find((c) => c.type === "identifier" || c.type === "text")
      ?.name;
  const categoryColumn = profile.columns.find(
    (c) =>
      c.type === "categorical" &&
      c.name !== nameColumn &&
      c.name !== numericColumns[0],
  )?.name;

  return {
    dataset: {
      kind: "geo",
      fileName,
      columns,
      rows,
      numericColumns,
      geojson: { type: "FeatureCollection", features },
      geometryKinds: kinds,
      valueColumn: numericColumns[0] ?? "",
      categoryColumn,
      nameColumn,
    },
  };
}

export interface GeoRender {
  geojson: GeoJSON.FeatureCollection;
  /** Numeric values painted on features (for classification), in order. */
  values: number[];
  /** Range of the numeric value column, when one is set and has numbers. */
  valueRange?: { min: number; max: number };
  /** Distinct categories (first-seen), when a category column is set. */
  categories: string[];
}

/**
 * Inject the render fields (`__value`, `__cat`, `__name`) onto each feature so
 * the MapLibre paint expressions can read them - mirroring how `joinChoropleth`
 * prepares bundled geometry. Pure and testable; the renderer stays "dumb".
 */
export function prepareGeoRender(
  dataset: GeoDataset,
  extraColumns: string[] = [],
): GeoRender {
  const { valueColumn, categoryColumn, nameColumn } = dataset;
  const categories: string[] = [];
  const catSeen = new Set<string>();
  const values: number[] = [];
  let min = Infinity;
  let max = -Infinity;

  const features = dataset.geojson.features.map((f) => {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {};

    if (valueColumn) {
      const v = parseNumber(stringifyCell(props[valueColumn]));
      if (v != null) {
        out.__value = v;
        values.push(v);
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (categoryColumn) {
      const c = stringifyCell(props[categoryColumn]);
      out.__cat = c;
      if (c !== "" && !catSeen.has(c)) {
        catSeen.add(c);
        categories.push(c);
      }
    }
    if (nameColumn) out.__name = stringifyCell(props[nameColumn]);
    for (const col of extraColumns) {
      if (col in props) out["col:" + col] = stringifyCell(props[col]);
    }

    return { ...f, properties: out } as GeoJSON.Feature;
  });

  const valueRange =
    Number.isFinite(min) && Number.isFinite(max) ? { min, max } : undefined;
  return {
    geojson: { type: "FeatureCollection", features },
    values,
    valueRange,
    categories,
  };
}
