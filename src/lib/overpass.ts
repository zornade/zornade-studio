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

/**
 * Geographic scope for an Overpass search. We scope by **area id** (resolved
 * via Nominatim geocoding, see lib/nominatim.ts) rather than by exact OSM name,
 * which is fragile ("Friuli" never matches "Friuli-Venezia Giulia"). Nationwide
 * uses Italy's area id directly (relation 365331 → 3600365331).
 */
export const ITALY_AREA_ID = 3600365331;
export type OsmScope =
  | { kind: "nationwide" }
  | { kind: "area"; areaId: number };

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
  timeoutSec = 25,
): string {
  const areaId = scope.kind === "nationwide" ? ITALY_AREA_ID : scope.areaId;
  const areaDef = `area(${areaId})->.a;`;
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
 * Run an Overpass query, trying each endpoint until one returns JSON. Each
 * attempt is bounded by its own timeout (via AbortController) so a hung or
 * overloaded server can never make the UI spin forever — on timeout we abort
 * and move to the next mirror. Throws a human-readable Error if every endpoint
 * fails, times out, or is overloaded (429/504/502/503).
 *
 * @param perEndpointTimeoutMs hard cap per endpoint attempt (default 30s).
 */
export async function runOverpass(
  query: string,
  endpoints: string[] = OVERPASS_ENDPOINTS,
  perEndpointTimeoutMs = 30_000,
): Promise<OverpassElement[]> {
  const reasons: string[] = [];

  for (const ep of endpoints) {
    const host = hostOf(ep);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perEndpointTimeoutMs);
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      });
      if (!res.ok) {
        // 429 rate-limit, 502/503/504 overloaded → try the next mirror.
        reasons.push(
          `${host}: ${res.status === 429 ? "troppe richieste" : `server occupato (${res.status})`}`,
        );
        continue;
      }
      const json = (await res.json()) as {
        elements?: OverpassElement[];
        remark?: string;
      };
      // Overpass can answer HTTP 200 with an empty body **and** a `remark`
      // describing a runtime error: the server-side query timed out, or the
      // mirror lacks the area database (`area_tags_local.bin` missing) so
      // `area(...)` silently matches nothing. Returning [] here would surface a
      // bogus "Nessun risultato"; instead treat it as a failed attempt and try
      // the next mirror. We only do this when there are no elements, so a
      // partial result with a warning remark is still kept.
      const elements = json.elements ?? [];
      if (elements.length === 0 && isRuntimeError(json.remark)) {
        reasons.push(`${host}: ${describeRemark(json.remark!)}`);
        continue;
      }
      return elements;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        reasons.push(`${host}: tempo scaduto (${perEndpointTimeoutMs / 1000}s)`);
      } else {
        reasons.push(`${host}: ${e instanceof Error ? e.message : "errore di rete"}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    "I server OpenStreetMap non hanno risposto. " +
      "Riprova tra poco o restringi l'ambito (es. per comune). " +
      `Dettagli: ${reasons.join(" · ")}.`,
  );
}

/** Short host label for error messages (e.g. "overpass-api.de"). */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Does an Overpass `remark` describe a server-side **runtime error** (timeout
 * or missing area database), as opposed to a benign note? Such a remark comes
 * back with HTTP 200 and an empty element set, so we must detect it explicitly.
 */
export function isRuntimeError(remark: string | undefined): boolean {
  if (!remark) return false;
  return /runtime error|timed out|out of memory/i.test(remark);
}

/** Turn a raw Overpass runtime remark into a short, human reason. */
function describeRemark(remark: string): string {
  if (/timed out/i.test(remark)) return "query troppo pesante (timeout server)";
  if (/area_tags_local|open64|No such file/i.test(remark))
    return "mirror senza dati delle aree";
  if (/out of memory/i.test(remark)) return "server sovraccarico (memoria)";
  return "errore lato server";
}
