/**
 * Nominatim geocoding for OSM area resolution (ROADMAP O2.5, hardening).
 *
 * The Overpass area scope used to match a place by its **exact** OSM `name`
 * (`area["name"="Friuli"]`), which fails for anything but the canonical name
 * (the region is actually "Friuli-Venezia Giulia"). Instead we **geocode** the
 * user's text with Nominatim (fuzzy, multilingual, CORS `*` verified
 * 2026-06-16) to get the matching administrative boundary's OSM id, then query
 * Overpass by **area id** - exact and robust.
 *
 * Overpass area id convention: relation → 3600000000 + osmId; way → 2400000000
 * + osmId. Nodes can't be areas, so we only accept relation/way boundaries.
 *
 * Usage policy: Nominatim asks for ≤ 1 req/sec and a descriptive User-Agent.
 * This is fine for interactive, on-demand searches.
 */

import type { Bbox } from "./overpass";

export const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

/** Scope hint → Nominatim `featureType` (helps disambiguate same-named places). */
export type GeocodeScope = "regione" | "provincia" | "comune" | "area";

const FEATURE_TYPE: Record<GeocodeScope, string | undefined> = {
  regione: "state",
  // Nominatim has no "province" featureType; geocode freely and pick a boundary.
  provincia: undefined,
  comune: "city",
  area: undefined,
};

export interface GeocodedArea {
  /** Overpass area id (3600000000 + relation id, or 2400000000 + way id). */
  areaId: number;
  /** Human-readable resolved name (e.g. "Friuli-Venezia Giulia, Italia"). */
  displayName: string;
  /** OSM type of the matched boundary. */
  osmType: "relation" | "way";
  osmId: number;
  /**
   * Bounding box of the boundary, when Nominatim reports one. Used to tile a
   * large area into fast bbox sub-queries (see runOverpassAdaptive).
   */
  bbox?: Bbox;
}

interface NominatimResult {
  osm_type?: string;
  osm_id?: number;
  display_name?: string;
  class?: string;
  type?: string;
  /** [south, north, west, east] as strings, per the Nominatim API. */
  boundingbox?: [string, string, string, string];
}

/** Convert an OSM relation/way id to an Overpass area id, or null for nodes. */
function toAreaId(osmType: string, osmId: number): number | null {
  if (osmType === "relation") return 3600000000 + osmId;
  if (osmType === "way") return 2400000000 + osmId;
  return null; // nodes have no area
}

/**
 * Geocode a place name to an administrative area.
 * When `countryBias` is set (e.g. "it"), results are narrowed to that country.
 * Omit it for global searches.
 *
 * @param query      free text typed by the operator (e.g. "Friuli", "Berlin")
 * @param scope      administrative level hint (a soft hint for featureType)
 * @param countryBias optional ISO 3166-1 alpha-2 code to restrict results
 */
export async function geocodeArea(
  query: string,
  scope: GeocodeScope,
  opts: { signal?: AbortSignal; endpoint?: string; countryBias?: string } = {},
): Promise<GeocodedArea | null> {
  const q = query.trim();
  if (q === "") return null;

  const params = new URLSearchParams({
    q,
    format: "json",
    limit: "5",
    "accept-language": "en,it",
  });
  if (opts.countryBias) params.set("countrycodes", opts.countryBias);
  const ft = FEATURE_TYPE[scope];
  if (ft) params.set("featureType", ft);

  const url = `${opts.endpoint ?? NOMINATIM_ENDPOINT}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: opts.signal,
  });
  if (!res.ok) throw new Error(`Geocoding non disponibile (HTTP ${res.status}).`);
  const results = (await res.json()) as NominatimResult[];
  return pickArea(results);
}

/** Parse Nominatim's [south, north, west, east] string box into a Bbox. */
function parseBoundingBox(
  box: [string, string, string, string] | undefined,
): Bbox | undefined {
  if (!box) return undefined;
  const [south, north, west, east] = box.map(Number);
  if ([south, north, west, east].some((n) => !Number.isFinite(n))) {
    return undefined;
  }
  return { south, north, west, east };
}

/** Pick the first usable administrative boundary (relation/way) from results. */
export function pickArea(results: NominatimResult[]): GeocodedArea | null {
  // Prefer an administrative boundary; fall back to any relation/way result.
  const ordered = [
    ...results.filter(
      (r) => r.class === "boundary" && r.type === "administrative",
    ),
    ...results,
  ];
  for (const r of ordered) {
    if (r.osm_type == null || r.osm_id == null) continue;
    const areaId = toAreaId(r.osm_type, r.osm_id);
    if (areaId == null) continue; // skip nodes
    return {
      areaId,
      displayName: r.display_name ?? "",
      osmType: r.osm_type as "relation" | "way",
      osmId: r.osm_id,
      bbox: parseBoundingBox(r.boundingbox),
    };
  }
  return null;
}
