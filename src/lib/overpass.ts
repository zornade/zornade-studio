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
 * Public Overpass endpoints. {@link runOverpass} does NOT just try them in
 * sequence - it races them with a staggered start (hedged requests), so a slow
 * or dead mirror can't stall the search.
 *
 * **Every endpoint here MUST cover the whole planet.** Regional mirrors are
 * banned: `overpass.osm.ch` (Switzerland-only) used to be listed first because
 * it was the fastest responder, but it answered HTTP 200 with an empty
 * `elements` array (and no runtime remark) for any feature outside Switzerland.
 * Since an empty 200 without a remark is treated as a *valid* "no results" that
 * wins the hedge race immediately, that mirror silently broke every search
 * outside CH (e.g. "Nessun defibrillatore trovato" over Italy). Removed
 * 2026-06-28. Only full-planet mirrors below, so an empty result is genuine.
 *
 * CORS (`Access-Control-Allow-Origin: *`) and global coverage verified
 * 2026-06-28 against the OSM wiki "Overpass API/Public instances" list:
 * - `maps.mail.ru` - full planet, fast (~0.9s), no rate limit, CORS *.
 * - `overpass-api.de` - FOSSGIS main instance, full planet, CORS *.
 * - `overpass.private.coffee` - ex `overpass.kumi.systems` (renamed), full
 *   planet, no rate limit, CORS *. Kept as best-effort fallback.
 */
export const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
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
  /** OSM id, used to de-duplicate features that straddle two tiles. */
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** A bounding box in decimal degrees. */
export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/**
 * Build a **single-tile** Overpass query: every filter is matched on
 * nodes/ways/relations within a bounding box, optionally also constrained to an
 * administrative area. Querying by bbox uses Overpass' spatial index and is
 * dramatically faster than scanning a whole `area()` (a nationwide `area()`
 * query times out), which is why {@link runOverpassAdaptive} tiles large scopes
 * into bbox sub-queries. When `areaId` is given, results are additionally
 * clipped to that boundary (`(area.a)` + bbox filters are AND-combined), so a
 * region/country search returns only features inside the administrative area.
 */
export function buildTileQuery(
  filters: OsmTagFilter[],
  tile: Bbox,
  areaId?: number,
  timeoutSec = 25,
): string {
  const bboxStr = `${tile.south},${tile.west},${tile.north},${tile.east}`;
  const areaSel = areaId != null ? "(area.a)" : "";
  const areaDef = areaId != null ? `area(${areaId})->.a;\n` : "";
  const body = filters
    .map((f) => `  nwr${selector(f)}${areaSel}(${bboxStr});`)
    .join("\n");
  return (
    `[out:json][timeout:${timeoutSec}];\n` +
    areaDef +
    `(\n${body}\n);\n` +
    `out center ${OVERPASS_MAX};`
  );
}

/** Split a bbox into its four equal quadrants (used to refine a heavy tile). */
export function splitQuad(b: Bbox): Bbox[] {
  const midLat = (b.south + b.north) / 2;
  const midLon = (b.west + b.east) / 2;
  return [
    { south: b.south, west: b.west, north: midLat, east: midLon },
    { south: b.south, west: midLon, north: midLat, east: b.east },
    { south: midLat, west: b.west, north: b.north, east: midLon },
    { south: midLat, west: midLon, north: b.north, east: b.east },
  ];
}

/**
 * Target side length (degrees) of an initial grid tile. A scope wider/taller
 * than this is split up-front so we never fire a single nationwide query that
 * is guaranteed to time out. ~3° keeps each tile well under the 2000-feature
 * cap for typical POI densities; anything still too dense is refined further.
 */
export const TILE_DEG = 3;

/** Build the initial (non-adaptive) grid of tiles covering a bbox. */
export function initialGrid(b: Bbox): Bbox[] {
  const width = b.east - b.west;
  const height = b.north - b.south;
  const cols = Math.max(1, Math.ceil(width / TILE_DEG));
  const rows = Math.max(1, Math.ceil(height / TILE_DEG));
  const dLon = width / cols;
  const dLat = height / rows;
  const tiles: Bbox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push({
        south: b.south + r * dLat,
        north: b.south + (r + 1) * dLat,
        west: b.west + c * dLon,
        east: b.west + (c + 1) * dLon,
      });
    }
  }
  return tiles;
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

/** Max recursive refinement depth per initial tile (4 → up to 256 sub-tiles). */
const MAX_TILE_DEPTH = 4;
/** Hard ceiling on the total number of tile queries, as a runaway safeguard. */
const MAX_TILES = 256;
/** How many tile queries run at once (kept low to avoid mirror rate limits). */
const TILE_CONCURRENCY = 3;

/** Run `fn` over `items` with a bounded number of concurrent executions. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx]);
    }
  };
  const n = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

/** De-dup key for an element: stable OSM id, or its coordinates as a fallback. */
function elementKey(el: OverpassElement): string {
  if (el.id != null) return `${el.type}/${el.id}`;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  return `${el.type}/${lat},${lon}`;
}

/**
 * Run an Overpass search over a potentially large scope **without timing out**,
 * by splitting it into bounding-box tiles (see {@link buildTileQuery}). The
 * scope is first covered by an {@link initialGrid}; any tile that the server
 * refuses (timeout/heavy) or that comes back truncated at the {@link OVERPASS_MAX}
 * cap is recursively re-split into quadrants ({@link splitQuad}) up to
 * {@link MAX_TILE_DEPTH}. Tiles run with bounded concurrency and results are
 * merged and de-duplicated by OSM id (features straddling a tile edge are
 * returned by both tiles).
 *
 * This is the high-level entry point the UI should use; {@link runOverpass} is
 * the per-tile network runner (one hedged request across mirrors).
 *
 * @param scope bounding box to cover, plus an optional admin `areaId` to clip to.
 * @param opts.onProgress called with the running count of processed tiles.
 * Rejects only when **every** tile failed and nothing could be collected.
 */
export async function runOverpassAdaptive(
  filters: OsmTagFilter[],
  scope: { bbox: Bbox; areaId?: number },
  opts: { endpoints?: string[]; onProgress?: (processed: number) => void } = {},
): Promise<OverpassElement[]> {
  const merged = new Map<string, OverpassElement>();
  const errors: string[] = [];
  let processed = 0;
  let totalTiles = 0;

  let tiles = initialGrid(scope.bbox);
  let depth = 0;

  while (tiles.length > 0 && totalTiles < MAX_TILES) {
    const results = await mapPool(tiles, TILE_CONCURRENCY, async (tile) => {
      totalTiles += 1;
      const query = buildTileQuery(filters, tile, scope.areaId);
      try {
        const els = await runOverpass(query, opts.endpoints);
        return { tile, els, ok: true as const };
      } catch (e) {
        return {
          tile,
          els: [] as OverpassElement[],
          ok: false as const,
          msg: e instanceof Error ? e.message : "errore di rete",
        };
      } finally {
        processed += 1;
        opts.onProgress?.(processed);
      }
    });

    const next: Bbox[] = [];
    const canRefine = depth < MAX_TILE_DEPTH && totalTiles < MAX_TILES;
    for (const r of results) {
      const truncated = r.ok && r.els.length >= OVERPASS_MAX;
      if ((!r.ok || truncated) && canRefine) {
        next.push(...splitQuad(r.tile));
      } else if (r.ok) {
        for (const el of r.els) {
          const key = elementKey(el);
          if (!merged.has(key)) merged.set(key, el);
        }
      } else {
        errors.push(r.msg);
      }
    }
    tiles = next;
    depth += 1;
  }

  if (merged.size === 0 && errors.length > 0) {
    throw new Error(
      "I server OpenStreetMap non hanno risposto. " +
        "Riprova tra poco o restringi l'ambito (es. per comune). " +
        `Dettagli: ${errors.slice(0, 3).join(" · ")}.`,
    );
  }
  return [...merged.values()];
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
