/**
 * Client for the live open-data catalogue, backed by the Netlify functions
 * `/api/ckan` (dataset search) and `/api/fetch` (resource download proxy).
 *
 * These endpoints only exist in production (Netlify). In plain `vite` dev they
 * 404, so {@link catalogApiAvailable} lets the UI fall back to the curated
 * static catalogue.
 */

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

/** Portals exposed by /api/ckan (kept in sync with the function whitelist). */
export const CATALOG_PORTALS: CatalogPortal[] = [
  { id: "nazionale", label: "dati.gov.it (nazionale)" },
  { id: "milano", label: "Comune di Milano" },
  { id: "napoli", label: "Comune di Napoli" },
  { id: "toscana", label: "Regione Toscana" },
  { id: "emilia", label: "Regione Emilia-Romagna" },
  { id: "roma", label: "Roma Capitale" },
];

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
