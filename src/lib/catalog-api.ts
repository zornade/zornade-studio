/**
 * Client for the live open-data catalogue, backed by the Netlify functions
 * `/api/ckan` (dataset search) and `/api/fetch` (resource download proxy).
 *
 * These endpoints only exist in production (Netlify). In plain `vite` dev they
 * 404, so {@link catalogApiAvailable} lets the UI fall back to the curated
 * static catalogue.
 */

import { activeSources } from "./sources";

export interface CkanResource {
  format: string;
  name: string;
  url: string;
}

export interface CkanDataset {
  id: string;
  title: string;
  publisher: string;
  notes: string;
  landing: string;
  resources: CkanResource[];
}

export interface CkanSearchResult {
  portal: string;
  count: number;
  results: CkanDataset[];
}

export interface CatalogPortal {
  id: string;
  label: string;
}

/**
 * Portals exposed in the UI. Derived from the shared {@link activeSources}
 * registry (single source of truth, also used by the `/api/ckan` proxy), with
 * blacklisted sources already filtered out — so this never drifts from the
 * server whitelist and a new portal appears automatically.
 */
export const CATALOG_PORTALS: CatalogPortal[] = activeSources().map((s) => ({
  id: s.id,
  label: s.label,
}));

let availability: boolean | null = null;

/** Probe whether the catalogue API (functions) is reachable. Cached. */
export async function catalogApiAvailable(): Promise<boolean> {
  if (availability !== null) return availability;
  try {
    const res = await fetch("/api/ckan?q=&rows=1", {
      headers: { accept: "application/json" },
    });
    const ct = res.headers.get("content-type") ?? "";
    availability = res.ok && ct.includes("application/json");
  } catch {
    availability = false;
  }
  return availability;
}

export async function searchCkan(
  query: string,
  portal: string,
  start = 0,
  rows = 20,
): Promise<CkanSearchResult> {
  const params = new URLSearchParams({
    q: query,
    portal,
    start: String(start),
    rows: String(rows),
  });
  const res = await fetch(`/api/ckan?${params.toString()}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Errore ${res.status}`);
  }
  return (await res.json()) as CkanSearchResult;
}

/** Download a resource through the proxy and return its text content. */
export async function fetchResourceText(resourceUrl: string): Promise<string> {
  const res = await fetch(`/api/fetch?url=${encodeURIComponent(resourceUrl)}`);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Download fallito (${res.status})`);
  }
  return await res.text();
}

// ── Eurostat ─────────────────────────────────────────────────────────────────

export interface EurostatSearchItem {
  code: string;
  label: string;
}

export interface EurostatSearchResult {
  count: number;
  results: EurostatSearchItem[];
}

/** Cerca tra tutti i dataset Eurostat (8237+) per parola chiave. */
export async function searchEurostat(
  query: string,
  start = 0,
  rows = 20,
): Promise<EurostatSearchResult> {
  const params = new URLSearchParams({
    mode: "search",
    q: query,
    start: String(start),
    rows: String(rows),
  });
  const res = await fetch(`/api/eurostat?${params.toString()}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Errore ${res.status}`);
  }
  return (await res.json()) as EurostatSearchResult;
}

/**
 * Scarica un dataset Eurostat come CSV piatto tramite il proxy.
 * @param code    Codice Eurostat (es. "DEMO_R_D3DENS")
 * @param geo     "paese" | "nuts2" | "nuts3"
 * @param filters Filtri dimensionali opzionali (es. { unit: "MIO_EUR" })
 */
export async function fetchEurostatCsv(
  code: string,
  geo: "paese" | "nuts2" | "nuts3",
  filters: Record<string, string> = {},
): Promise<string> {
  const params = new URLSearchParams({
    mode: "data",
    code,
    geo,
    filters: JSON.stringify(filters),
  });
  const res = await fetch(`/api/eurostat?${params.toString()}`);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Download fallito (${res.status})`);
  }
  return await res.text();
}
