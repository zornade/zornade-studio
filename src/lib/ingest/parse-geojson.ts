/**
 * GeoJSON / JSON → tabular { columns, rows } (ROADMAP O2.3).
 *
 * The current map pipeline is a choropleth that joins a **table** to the
 * **bundled** geometry (regioni/province/comuni/paesi). So here we treat a
 * GeoJSON as a *table*: each feature's `properties` becomes a row, and the
 * union of all property keys becomes the columns. If the properties carry a
 * geo-key column (e.g. a region name or ISTAT code) and a numeric column, the
 * existing geo-resolve + join produces a choropleth — no new render path.
 *
 * (Rendering the GeoJSON's own geometry as a custom layer is a separate, later
 * step — O2.4+ — once user-supplied geometry has a layer to live on.)
 *
 * Plain JSON is also accepted when it is an array of flat objects (a common
 * "export to JSON" shape), which maps to rows directly.
 *
 * No dependency: native `JSON.parse`.
 */

import type { ParsedCsv } from "../csv";

export type GeoJsonParseError = { error: string };

/** Parse GeoJSON/JSON text into { columns, rows }, or a human error message. */
export function parseGeoJson(text: string): ParsedCsv | GeoJsonParseError {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "Il file JSON non è valido." };
  }

  const records = extractRecords(data);
  if ("error" in records) return records;
  if (records.rows.length === 0) {
    return { error: "Nessuna riga di dati trovata nel file." };
  }
  return toTable(records.rows);
}

interface Records {
  rows: Record<string, unknown>[];
}

/** Pull an array of flat records out of the supported JSON shapes. */
function extractRecords(data: unknown): Records | GeoJsonParseError {
  // GeoJSON FeatureCollection → each feature's properties is a record.
  if (
    isObject(data) &&
    data.type === "FeatureCollection" &&
    Array.isArray((data as { features?: unknown }).features)
  ) {
    const features = (data as { features: unknown[] }).features;
    const rows = features
      .filter(isObject)
      .map((f) => {
        const props = (f as { properties?: unknown }).properties;
        return isObject(props) ? (props as Record<string, unknown>) : {};
      });
    return { rows };
  }

  // A single GeoJSON Feature.
  if (isObject(data) && data.type === "Feature") {
    const props = (data as { properties?: unknown }).properties;
    return { rows: [isObject(props) ? (props as Record<string, unknown>) : {}] };
  }

  // A plain array of flat objects (generic JSON export).
  if (Array.isArray(data)) {
    const rows = data.filter(isObject) as Record<string, unknown>[];
    if (rows.length === 0) {
      return { error: "L'array JSON non contiene oggetti di dati." };
    }
    return { rows };
  }

  return {
    error:
      "Formato non riconosciuto: serve un GeoJSON (FeatureCollection) o un array di oggetti.",
  };
}

/** Build columns (union of keys, first-seen order) + stringified rows. */
function toTable(records: Record<string, unknown>[]): ParsedCsv {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const rec of records) {
    for (const key of Object.keys(rec)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  const rows = records.map((rec) => {
    const row: Record<string, string> = {};
    for (const col of columns) row[col] = stringifyCell(rec[col]);
    return row;
  });
  return { columns, rows };
}

/** Stringify a property value the way the rest of the pipeline expects. */
function stringifyCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // Objects/arrays (nested) → compact JSON so nothing is silently lost.
  return JSON.stringify(value);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
