/**
 * OpenStreetMap data via the Overpass API (ROADMAP O2.5).
 *
 * Overpass is queried **directly from the browser**: the public endpoints send
 * `Access-Control-Allow-Origin: *` (verified 2026-06-16), so no proxy is needed
 * (unlike the CKAN catalogue). Data is © OpenStreetMap contributors under ODbL;
 * the map already carries OSM attribution.
 *
 * This module is split into a **pure** query-builder + response-converter
 * (unit-tested) and a thin network runner with endpoint fallback.
 */

import type { OsmTagFilter } from "../studio/catalog";

/** Public Overpass endpoints, tried in order (the first that responds wins). */
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/** Italian administrative levels in OSM (region 4, province 6, comune 8). */
export type OsmScope =
  | { kind: "nationwide" }
  | { kind: "area"; name: string; adminLevel: 4 | 6 | 8 };

/** Hard cap on returned features (Overpass `out` count) to keep it manageable. */
export const OVERPASS_MAX = 2000;

/** Escape a string for safe inclusion in an Overpass QL double-quoted literal. */
function ql(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** A single tag filter → an Overpass selector like `["amenity"="school"]`. */
function selector(f: OsmTagFilter): string {
  return f.value != null
    ? `["${ql(f.key)}"="${ql(f.value)}"]`
    : `["${ql(f.key)}"]`;
}

/**
 * Build an Overpass QL query: every filter is matched on nodes/ways/relations
 * (`nwr`), OR-combined, within the chosen scope, returning element centres.
 */
export function buildOverpassQuery(
  filters: OsmTagFilter[],
  scope: OsmScope,
  timeoutSec = 60,
): string {
  const areaDef =
    scope.kind === "nationwide"
      ? `area["ISO3166-1"="IT"]["admin_level"="2"]->.a;`
      : `area["name"="${ql(scope.name)}"]["admin_level"="${scope.adminLevel}"]->.a;`;
  const body = filters
    .map((f) => `  nwr${selector(f)}(area.a);`)
    .join("\n");
  return (
    `[out:json][timeout:${timeoutSec}];\n` +
    `${areaDef}\n` +
    `(\n${body}\n);\n` +
    `out center ${OVERPASS_MAX};`
  );
}

/** A raw Overpass element (only the fields we read). */
export interface OverpassElement {
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OverpassTable {
  columns: string[];
  rows: Record<string, string>[];
  /** Features dropped for missing coordinates. */
  dropped: number;
}

/**
 * Convert Overpass elements into a point table with the columns the point
 * pipeline expects (`lat`/`lon` literally), plus `nome`, `categoria` and
 * `indirizzo`. The category is the matched filter (so e.g. ports split into
 * `harbour=yes` vs `leisure=marina`), which makes the category colouring useful.
 */
export function overpassToTable(
  elements: OverpassElement[],
  filters: OsmTagFilter[],
): OverpassTable {
  const columns = ["nome", "categoria", "indirizzo", "lat", "lon", "tipo_osm"];
  const rows: Record<string, string>[] = [];
  let dropped = 0;

  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) {
      dropped++;
      continue;
    }
    const tags = el.tags ?? {};
    rows.push({
      nome: tags.name ?? tags["name:it"] ?? "(senza nome)",
      categoria: categoryFor(tags, filters),
      indirizzo: formatAddress(tags),
      lat: String(lat),
      lon: String(lon),
      tipo_osm: el.type,
    });
  }
  return { columns, rows, dropped };
}

/** Category = the first filter the element matches, as "key=value" (or key). */
function categoryFor(
  tags: Record<string, string>,
  filters: OsmTagFilter[],
): string {
  for (const f of filters) {
    if (f.key in tags && (f.value == null || tags[f.key] === f.value)) {
      return f.value ?? tags[f.key];
    }
  }
  return "altro";
}

/** Compose a human address from the addr:* tags, when present. */
function formatAddress(tags: Record<string, string>): string {
  const street = tags["addr:street"];
  const num = tags["addr:housenumber"];
  const city = tags["addr:city"];
  const line = [street, num].filter(Boolean).join(" ");
  return [line, city].filter(Boolean).join(", ");
}

/**
 * Run an Overpass query, trying each endpoint until one returns JSON. Throws a
 * human-readable Error if all endpoints fail or are overloaded.
 */
export async function runOverpass(
  query: string,
  endpoints: string[] = OVERPASS_ENDPOINTS,
): Promise<OverpassElement[]> {
  let lastError = "";
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
      });
      if (!res.ok) {
        // 429/504 → endpoint busy: try the next mirror.
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const json = (await res.json()) as { elements?: OverpassElement[] };
      return json.elements ?? [];
    } catch (e) {
      lastError = e instanceof Error ? e.message : "errore di rete";
    }
  }
  throw new Error(
    `Nessun server OpenStreetMap ha risposto (${lastError}). Riprova tra poco.`,
  );
}
