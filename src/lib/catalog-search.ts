/**
 * Catalogue search adapters (CKAN + Socrata), shared by the server proxy
 * (`netlify/functions/ckan.mts`) and the `probe:portals` script so the exact
 * same normalisation logic is exercised in production and in the health probe -
 * no duplicated, drifting copies.
 *
 * Pure and dependency-free: the caller injects a `fetch` implementation (the
 * global one in both Netlify and Node 18+), which also makes the adapters
 * trivially unit-testable with a mock.
 */

import { landingUrl, type OpenDataSource } from "./sources";

/** A loadable resource attached to a dataset. */
export interface NormalisedResource {
  format: string;
  name: string;
  url: string;
}

/** Adapter-independent dataset shape returned to the client. */
export interface NormalisedDataset {
  id: string;
  title: string;
  publisher: string;
  notes: string;
  landing: string;
  resources: NormalisedResource[];
}

export interface NormalisedResult {
  portal: string;
  count: number;
  results: NormalisedDataset[];
}

export interface SearchParams {
  q?: string;
  start?: number;
  rows?: number;
}

/** Resource formats we can preview/load (tabular or geographic). */
export const USABLE = /^(csv|json|geojson|xlsx|xls|geopackage|gpkg)$/i;

/** A user-facing failure raised by an adapter. */
export class PortalError extends Error {}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Dispatch a catalogue search to the right adapter for the source `kind`. */
export async function searchSource(
  source: OpenDataSource,
  params: SearchParams = {},
  fetchImpl: FetchLike = fetch,
  timeoutMs = 20000,
): Promise<NormalisedResult> {
  const q = (params.q ?? "").slice(0, 200);
  const start = Math.max(0, params.start ?? 0);
  const rows = Math.min(50, Math.max(1, params.rows ?? 20));
  if (source.kind === "socrata")
    return searchSocrata(source, q, start, rows, fetchImpl, timeoutMs);
  if (source.kind === "dcat")
    return searchDcatEuropa(source, q, start, rows, fetchImpl, timeoutMs);
  return searchCkan(source, q, start, rows, fetchImpl, timeoutMs);
}

// --- CKAN ------------------------------------------------------------------

interface CkanResource {
  format?: string;
  name?: string;
  url?: string;
}
interface CkanPackage {
  id?: string;
  name?: string;
  title?: string;
  notes?: string;
  organization?: { title?: string; name?: string } | null;
  resources?: CkanResource[];
}

async function searchCkan(
  source: OpenDataSource,
  q: string,
  start: number,
  rows: number,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<NormalisedResult> {
  const api = `${source.api}?q=${encodeURIComponent(q)}&rows=${rows}&start=${start}`;
  const res = (await fetchJson(api, fetchImpl, timeoutMs)) as {
    result?: { count?: number; results?: CkanPackage[] };
  };
  const pkgs = res.result?.results ?? [];

  const results = pkgs
    .map((p): NormalisedDataset => {
      const resources = (p.resources ?? [])
        .filter((r) => r.url && USABLE.test((r.format ?? "").trim()))
        .map((r) => ({
          format: (r.format ?? "").toUpperCase(),
          name: r.name ?? "",
          url: r.url as string,
        }));
      return {
        id: p.id ?? p.name ?? "",
        title: p.title ?? p.name ?? "(senza titolo)",
        publisher: p.organization?.title ?? source.label,
        notes: (p.notes ?? "").slice(0, 280),
        landing: landingUrl(source, p.name ?? ""),
        resources,
      };
    })
    .filter((p) => p.resources.length > 0);

  return { portal: source.label, count: res.result?.count ?? results.length, results };
}

// --- Socrata ---------------------------------------------------------------

interface SocrataResource {
  id?: string;
  name?: string;
  description?: string;
  attribution?: string;
  type?: string;
}
interface SocrataItem {
  resource?: SocrataResource;
  metadata?: { domain?: string };
  permalink?: string;
}

async function searchSocrata(
  source: OpenDataSource,
  q: string,
  start: number,
  rows: number,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<NormalisedResult> {
  const domain = source.domain ?? "";
  // The Discovery API is federated, so always scope to this portal's own
  // domain and only return tabular datasets (which have a CSV export).
  const search = new URLSearchParams({
    limit: String(rows),
    offset: String(start),
    only: "dataset",
    search_context: domain,
    domains: domain,
  });
  if (q) search.set("q", q);
  const res = (await fetchJson(`${source.api}?${search.toString()}`, fetchImpl, timeoutMs)) as {
    results?: SocrataItem[];
    resultSetSize?: number;
  };
  const items = res.results ?? [];

  const results = items
    .map((it): NormalisedDataset | null => {
      const r = it.resource;
      const dom = it.metadata?.domain ?? domain;
      if (!r?.id || r.type !== "dataset" || !dom) return null;
      // Socrata exposes every tabular dataset as a CSV export on its own host.
      return {
        id: r.id,
        title: r.name ?? "(senza titolo)",
        publisher: r.attribution ?? source.label,
        notes: (r.description ?? "").slice(0, 280),
        landing: it.permalink ?? `https://${dom}/d/${r.id}`,
        resources: [{ format: "CSV", name: r.name ?? "", url: `https://${dom}/resource/${r.id}.csv` }],
      };
    })
    .filter((p): p is NormalisedDataset => p !== null);

  return { portal: source.label, count: res.resultSetSize ?? results.length, results };
}

// --- DCAT-AP (data.europa.eu) ----------------------------------------------
//
// The official EU portal exposes a CKAN-shaped envelope ({success, result})
// but the dataset/resource bodies follow DCAT-AP and differ from plain CKAN in
// ways that would make the generic CKAN adapter return ZERO usable resources:
//
//   - the resource download URL is in `access_url`, NOT `url`, and is wrapped
//     in literal square brackets, e.g. "[https://host/file.csv]";
//   - the resource label is in `title`, not `name`;
//   - `format` is frequently null even for real data files (we then infer it
//     from the URL extension);
//   - the publisher is `publisher.name` (the `organization.title` field is a
//     multilingual object, not a string);
//   - `title`/`notes` can be null or, in some harvested records, multilingual
//     objects keyed by language code.
//
// This adapter normalises all of the above so every surfaced dataset has a
// clean, loadable resource list - verified live by `probe:portals`.

/** A value that may be a plain string or a {lang: string} translation map. */
type MaybeLangMap = string | Record<string, string> | null | undefined;

interface DcatResource {
  access_url?: string;
  download_url?: string;
  format?: MaybeLangMap | { label?: string };
  title?: MaybeLangMap;
  name?: MaybeLangMap;
}
interface DcatPackage {
  id?: string;
  name?: string;
  title?: MaybeLangMap;
  notes?: MaybeLangMap;
  publisher?: { name?: string } | null;
  resources?: DcatResource[];
}

/** Coerce a possibly-multilingual field to a single string (it → en → first). */
function pickLang(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const m = v as Record<string, string>;
    if (typeof m.label === "string") return m.label; // {label: "CSV"}
    return m.it ?? m.en ?? Object.values(m).find((x) => typeof x === "string") ?? "";
  }
  return "";
}

/**
 * Strip the literal square brackets data.europa.eu wraps every `access_url` in
 * ("[https://host/file.csv]" → "https://host/file.csv"). Returns "" when the
 * result is not an absolute http(s) URL.
 */
function cleanAccessUrl(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("[") && s.endsWith("]")) s = s.slice(1, -1).trim();
  return /^https?:\/\//i.test(s) ? s : "";
}

/** Infer a usable format from the URL extension when `format` is missing. */
function inferFormat(url: string): string {
  const m = url.toLowerCase().match(/\.(csv|geojson|json|xlsx|xls|gpkg|geopackage)(?:$|[?#])/);
  return m ? m[1] : "";
}

async function searchDcatEuropa(
  source: OpenDataSource,
  q: string,
  start: number,
  rows: number,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<NormalisedResult> {
  const api = `${source.api}?q=${encodeURIComponent(q)}&rows=${rows}&start=${start}`;
  const res = (await fetchJson(api, fetchImpl, timeoutMs)) as {
    result?: { count?: number; results?: DcatPackage[] };
  };
  const pkgs = res.result?.results ?? [];

  const results = pkgs
    .map((p): NormalisedDataset => {
      const resources = (p.resources ?? [])
        .map((r) => {
          const url = cleanAccessUrl(pickLang(r.access_url) || pickLang(r.download_url));
          const fmt = (pickLang(r.format).trim() || inferFormat(url)).toUpperCase();
          return { url, fmt, name: pickLang(r.title) || pickLang(r.name) };
        })
        .filter((r) => r.url && USABLE.test(r.fmt))
        .map((r) => ({ format: r.fmt, name: r.name, url: r.url }));

      const id = p.id ?? p.name ?? "";
      return {
        id,
        title: pickLang(p.title) || id || "(senza titolo)",
        publisher: p.publisher?.name ?? source.label,
        notes: pickLang(p.notes).slice(0, 280),
        landing: landingUrl(source, id),
        resources,
      };
    })
    .filter((p) => p.resources.length > 0);

  return { portal: source.label, count: res.result?.count ?? results.length, results };
}

// --- shared fetch ----------------------------------------------------------

async function fetchJson(apiUrl: string, fetchImpl: FetchLike, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(apiUrl, {
      headers: { accept: "application/json", "user-agent": "ZornadeStudio/1.0" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new PortalError("Impossibile contattare il portale.");
  }
  if (!res.ok) throw new PortalError(`Il portale ha risposto ${res.status}.`);
  try {
    return await res.json();
  } catch {
    throw new PortalError("Il portale ha restituito una risposta non valida.");
  }
}
