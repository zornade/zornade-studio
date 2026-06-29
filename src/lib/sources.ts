/**
 * Single source of truth for the live open-data **sources** (catalogue portals)
 * that Zornade Studio can search and load from.
 *
 * This module is imported by BOTH sides of the integration, so the portal list
 * is never duplicated or allowed to drift:
 *   - the browser client ({@link ../lib/catalog-api}) derives the portal
 *     dropdown from {@link activeSources};
 *   - the server proxy (`netlify/functions/ckan.mts`) uses the same registry as
 *     its SSRF whitelist and to pick the right adapter per source.
 *
 * Adding a new portal = ONE entry here. No code change anywhere else is needed
 * for it to appear in the UI and become reachable through the proxy. The only
 * intentionally hard-coded piece is {@link SOURCE_BLACKLIST}: sources that were
 * verified to be permanently down/unreachable are listed there and hidden from
 * the user - but the `probe:portals` script re-checks them every run, so a
 * source that comes back online can be promoted again.
 *
 * Every entry below was verified live (real `success: true` / HTTP 200 with a
 * non-empty catalogue) on 2026-06-22.
 */

/** Catalogue platform - determines which adapter the proxy uses. */
export type SourceKind = "ckan" | "socrata" | "dcat";

/** Geographic reach of a source (used for grouping/labelling only). */
export type SourceScope = "europeo" | "nazionale" | "regione" | "comune";

export interface OpenDataSource {
  /** Stable slug used as the `portal` API parameter and blacklist key. */
  id: string;
  /** Human label shown in the UI. */
  label: string;
  /** Catalogue platform. */
  kind: SourceKind;
  /**
   * Base API endpoint.
   *  - `ckan`:    full `package_search` action URL.
   *  - `socrata`: the Discovery API `…/api/catalog/v1` URL.
   */
  api: string;
  /**
   * Socrata download/scoping host (e.g. `www.dati.lombardia.it`). Required for
   * `socrata` sources, ignored for `ckan`. The catalogue is federated, so we
   * always scope queries to this domain and build resource URLs from it.
   */
  domain?: string;
  /**
   * CKAN landing-page pattern with a `{name}` placeholder. For `socrata` the
   * landing URL comes from the API `permalink`, so this is optional.
   */
  landingPattern?: string;
  /** Geographic reach. */
  scope: SourceScope;
  /** Human geographic label, e.g. "Italia", "Toscana", "Milano". */
  region: string;
}

/**
 * The registry. Order = display order (national first, then regions, then
 * cities). Keep it alphabetical-ish within each scope for readability.
 */
export const OPEN_DATA_SOURCES: OpenDataSource[] = [
  // --- European (supranational) ---------------------------------------------
  {
    id: "data-europa",
    label: "data.europa.eu (UE)",
    kind: "dcat",
    // CKAN-compatible hub endpoint of the official EU open-data portal. It
    // federates ~1.7M datasets harvested from every member-state portal and
    // returns a DCAT-AP shape that needs its own adapter (see catalog-search).
    api: "https://data.europa.eu/api/hub/search/ckan/package_search",
    // Landing pages are keyed by dataset id, not name; the DCAT adapter passes
    // the id through landingUrl(), so {name} is substituted with the id.
    landingPattern: "https://data.europa.eu/data/datasets/{name}?locale=it",
    scope: "europeo",
    region: "Unione Europea",
  },

  // --- National --------------------------------------------------------------
  {
    id: "nazionale",
    label: "dati.gov.it (nazionale)",
    kind: "ckan",
    api: "https://www.dati.gov.it/opendata/api/3/action/package_search",
    landingPattern: "https://www.dati.gov.it/view-dataset?id={name}",
    scope: "nazionale",
    region: "Italia",
  },

  // --- Regions ---------------------------------------------------------------
  {
    id: "emilia",
    label: "Regione Emilia-Romagna",
    kind: "ckan",
    api: "https://dati.emilia-romagna.it/api/3/action/package_search",
    landingPattern: "https://dati.emilia-romagna.it/dataset/{name}",
    scope: "regione",
    region: "Emilia-Romagna",
  },
  {
    id: "friuli",
    label: "Regione Friuli-Venezia Giulia",
    kind: "socrata",
    api: "https://www.dati.friuliveneziagiulia.it/api/catalog/v1",
    domain: "www.dati.friuliveneziagiulia.it",
    scope: "regione",
    region: "Friuli-Venezia Giulia",
  },
  {
    id: "lazio",
    label: "Regione Lazio",
    kind: "ckan",
    api: "https://dati.lazio.it/api/3/action/package_search",
    landingPattern: "https://dati.lazio.it/dataset/{name}",
    scope: "regione",
    region: "Lazio",
  },
  {
    id: "lombardia",
    label: "Regione Lombardia",
    kind: "socrata",
    api: "https://www.dati.lombardia.it/api/catalog/v1",
    domain: "www.dati.lombardia.it",
    scope: "regione",
    region: "Lombardia",
  },
  {
    id: "puglia",
    label: "Regione Puglia",
    kind: "ckan",
    api: "https://dati.puglia.it/ckan/api/3/action/package_search",
    landingPattern: "https://dati.puglia.it/ckan/dataset/{name}",
    scope: "regione",
    region: "Puglia",
  },
  {
    id: "sicilia",
    label: "Regione Siciliana",
    kind: "ckan",
    api: "https://dati.regione.sicilia.it/api/3/action/package_search",
    landingPattern: "https://dati.regione.sicilia.it/dataset/{name}",
    scope: "regione",
    region: "Sicilia",
  },
  {
    id: "toscana",
    label: "Regione Toscana",
    kind: "ckan",
    api: "https://dati.toscana.it/api/3/action/package_search",
    landingPattern: "https://dati.toscana.it/dataset/{name}",
    scope: "regione",
    region: "Toscana",
  },
  {
    id: "trentino",
    label: "Provincia Autonoma di Trento",
    kind: "ckan",
    api: "https://dati.trentino.it/api/3/action/package_search",
    landingPattern: "https://dati.trentino.it/dataset/{name}",
    scope: "regione",
    region: "Trentino",
  },

  // --- Cities ----------------------------------------------------------------
  {
    id: "milano",
    label: "Comune di Milano",
    kind: "ckan",
    api: "https://dati.comune.milano.it/api/3/action/package_search",
    landingPattern: "https://dati.comune.milano.it/dataset/{name}",
    scope: "comune",
    region: "Milano",
  },
  {
    id: "napoli",
    label: "Comune di Napoli",
    kind: "ckan",
    api: "https://dati.comune.napoli.it/api/3/action/package_search",
    landingPattern: "https://dati.comune.napoli.it/dataset/{name}",
    scope: "comune",
    region: "Napoli",
  },
  {
    id: "reggio-calabria",
    label: "Comune di Reggio Calabria",
    kind: "ckan",
    api: "http://ckan.reggiocal.it/api/3/action/package_search",
    landingPattern: "http://ckan.reggiocal.it/dataset/{name}",
    scope: "comune",
    region: "Reggio Calabria",
  },
  {
    id: "roma",
    label: "Roma Capitale",
    kind: "ckan",
    api: "https://dati.comune.roma.it/catalog/api/3/action/package_search",
    landingPattern: "https://dati.comune.roma.it/catalog/dataset/{name}",
    scope: "comune",
    region: "Roma",
  },
  {
    id: "torino",
    label: "Comune di Torino (aperTO)",
    kind: "ckan",
    api: "https://aperto.comune.torino.it/api/3/action/package_search",
    landingPattern: "https://aperto.comune.torino.it/dataset/{name}",
    scope: "comune",
    region: "Torino",
  },
];

/** A source/resource that was verified down and is hidden from the user. */
export interface BlacklistEntry {
  /** Source id (portal-level) or exact resource URL (resource-level). */
  id: string;
  /** Why it is blacklisted (human readable, shown only in probe reports). */
  reason: string;
  /** ISO date (YYYY-MM-DD) when it was added - used to re-check staleness. */
  since: string;
}

/**
 * Hard-coded blacklist. The ONLY place where a hard-coded decision about a
 * source is allowed. Populate from `npm run probe:portals` output when a source
 * is confirmed permanently unreachable. The probe re-checks these every run and
 * flags any that have come back online so they can be removed from here.
 *
 * Empty by design right now: all {@link OPEN_DATA_SOURCES} were verified live.
 */
export const SOURCE_BLACKLIST: BlacklistEntry[] = [];

const blacklistIds = new Set(SOURCE_BLACKLIST.map((b) => b.id));

/** True if a source id (or resource URL) is blacklisted. */
export function isBlacklisted(idOrUrl: string): boolean {
  return blacklistIds.has(idOrUrl);
}

/** Sources that are NOT blacklisted - what the UI should show. */
export function activeSources(): OpenDataSource[] {
  return OPEN_DATA_SOURCES.filter((s) => !blacklistIds.has(s.id));
}

/** Look up a source by id (ignores the blacklist; callers decide). */
export function sourceById(id: string): OpenDataSource | undefined {
  return OPEN_DATA_SOURCES.find((s) => s.id === id);
}

/** Build a dataset landing URL for a CKAN source, or "" when unknown. */
export function landingUrl(source: OpenDataSource, name: string): string {
  if (!source.landingPattern) return "";
  return source.landingPattern.replace("{name}", encodeURIComponent(name));
}
