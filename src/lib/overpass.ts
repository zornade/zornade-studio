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

/**
 * Public Overpass endpoints. Ordered fastest-first, but {@link runOverpass}
 * does NOT just try them in sequence - it races them with a staggered start
 * (hedged requests), so a slow or dead mirror can't stall the search. CORS
 * (`Access-Control-Allow-Origin: *`) and reachability re-verified 2026-06-26:
 * `overpass.osm.ch` (~0.5s) and `maps.mail.ru` (~0.9s) were the fastest with
 * CORS enabled; `overpass-api.de` works but is often slow/overloaded; the last
 * two are kept as best-effort fallbacks (they were timing out on 2026-06-26 but
 * recover over time, and hedging makes a dead mirror harmless).
 */
export const OVERPASS_ENDPOINTS = [
  "https://overpass.osm.ch/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
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
  | { kind: "area"; areaId: number }
  /**
   * Bounding box [south, west, north, east] in decimal degrees.
   * This is the primary scope for global searches: the user draws or types a
   * bbox and Overpass filters within it. No Nominatim call needed.
   */
  | { kind: "bbox"; south: number; west: number; north: number; east: number };

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
  if (scope.kind === "bbox") {
    const { south, west, north, east } = scope;
    const bboxStr = `${south},${west},${north},${east}`;
    const body = filters
      .map((f) => `  nwr${selector(f)}(${bboxStr});`)
      .join("\n");
    return (
      `[out:json][timeout:${timeoutSec}];\n` +
      `(\n${body}\n);\n` +
      `out center ${OVERPASS_MAX};`
    );
  }
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
 * Run an Overpass query against several mirrors using **hedged requests**: the
 * first endpoint starts immediately and, if it hasn't answered within
 * `hedgeDelayMs`, the next mirror is fired *in parallel* (and so on). The first
 * valid response wins and every other in-flight request is aborted. A failing
 * mirror (HTTP error, network error, timeout, or an empty 200 with a runtime
 * remark) immediately escalates to the next one. This makes the search robust
 * to a slow or dead mirror - total wall time is bounded by the *fastest*
 * responder, not the sum of per-endpoint timeouts.
 *
 * A genuinely empty result (HTTP 200, `elements: []`, no runtime remark) is a
 * valid answer and wins immediately without trying other mirrors.
 *
 * Rejects with a single human-readable Error only when EVERY endpoint has been
 * tried and all failed.
 *
 * @param perEndpointTimeoutMs hard cap per endpoint attempt (default 30s).
 * @param hedgeDelayMs head-start before adding the next mirror in parallel
 *   (default 6s). A failure escalates immediately regardless of this delay.
 */
export async function runOverpass(
  query: string,
  endpoints: string[] = OVERPASS_ENDPOINTS,
  perEndpointTimeoutMs = 30_000,
  hedgeDelayMs = 6_000,
): Promise<OverpassElement[]> {
  const reasons: string[] = [];
  const controllers = new Set<AbortController>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let nextIndex = 0;
  let failed = 0;
  let settled = false;

  return new Promise<OverpassElement[]>((resolve, reject) => {
    const cleanup = () => {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const c of controllers) c.abort();
      controllers.clear();
    };

    const succeed = (elements: OverpassElement[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(elements);
    };

    const fail = (reason: string) => {
      if (settled) return;
      reasons.push(reason);
      failed += 1;
      if (failed >= endpoints.length) {
        settled = true;
        cleanup();
        reject(
          new Error(
            "I server OpenStreetMap non hanno risposto. " +
              "Riprova tra poco o restringi l'ambito (es. per comune). " +
              `Dettagli: ${reasons.join(" · ")}.`,
          ),
        );
        return;
      }
      // Escalate immediately: bring in the next mirror without waiting for the
      // hedge delay (this preserves the simple "fall through to next" behaviour
      // when an endpoint fails fast).
      launchNext();
    };

    const attempt = (ep: string) => {
      const host = hostOf(ep);
      const controller = new AbortController();
      controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), perEndpointTimeoutMs);
      timers.add(timer);

      fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) {
            fail(
              `${host}: ${res.status === 429 ? "troppe richieste" : `server occupato (${res.status})`}`,
            );
            return;
          }
          const json = (await res.json()) as {
            elements?: OverpassElement[];
            remark?: string;
          };
          // Overpass can answer HTTP 200 with an empty body **and** a `remark`
          // describing a runtime error (server-side timeout, or a mirror lacking
          // the area database). Treat that as a failed attempt, not "no results".
          const elements = json.elements ?? [];
          if (elements.length === 0 && isRuntimeError(json.remark)) {
            fail(`${host}: ${describeRemark(json.remark!)}`);
            return;
          }
          succeed(elements);
        })
        .catch((e: unknown) => {
          if (e instanceof DOMException && e.name === "AbortError") {
            // Aborted because another mirror already won: stay silent.
            if (settled) return;
            fail(`${host}: tempo scaduto (${perEndpointTimeoutMs / 1000}s)`);
          } else {
            fail(`${host}: ${e instanceof Error ? e.message : "errore di rete"}`);
          }
        })
        .finally(() => {
          clearTimeout(timer);
          timers.delete(timer);
          controllers.delete(controller);
        });
    };

    const launchNext = () => {
      if (settled || nextIndex >= endpoints.length) return;
      const ep = endpoints[nextIndex++];
      attempt(ep);
      // Schedule the next mirror to join in parallel if this one is slow.
      if (nextIndex < endpoints.length) {
        const t = setTimeout(() => {
          timers.delete(t);
          launchNext();
        }, hedgeDelayMs);
        timers.add(t);
      }
    };

    launchNext();
  });
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
