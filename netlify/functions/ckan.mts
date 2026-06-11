/**
 * GET /api/ckan?q=<query>&portal=<id>&start=<n>&rows=<n>
 *
 * Server-side proxy to CKAN `package_search` for Italian open-data portals.
 * Runs on Netlify so it is not subject to browser CORS: the client calls this
 * same-origin endpoint, we call the portal, and we return a normalised, compact
 * list of datasets that actually have loadable resources.
 *
 * Only whitelisted portals are reachable (no arbitrary SSRF target here).
 */

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

/** Whitelisted CKAN portals (base API URL + human label + landing pattern). */
const PORTALS: Record<
  string,
  { label: string; api: string; landing: (name: string) => string }
> = {
  nazionale: {
    label: "dati.gov.it (nazionale)",
    api: "https://www.dati.gov.it/opendata/api/3/action/package_search",
    landing: (n) => `https://www.dati.gov.it/view-dataset?id=${encodeURIComponent(n)}`,
  },
  milano: {
    label: "Comune di Milano",
    api: "https://dati.comune.milano.it/api/3/action/package_search",
    landing: (n) => `https://dati.comune.milano.it/dataset/${n}`,
  },
  napoli: {
    label: "Comune di Napoli",
    api: "https://dati.comune.napoli.it/api/3/action/package_search",
    landing: (n) => `https://dati.comune.napoli.it/dataset/${n}`,
  },
  toscana: {
    label: "Regione Toscana",
    api: "https://dati.toscana.it/api/3/action/package_search",
    landing: (n) => `https://dati.toscana.it/dataset/${n}`,
  },
  emilia: {
    label: "Regione Emilia-Romagna",
    api: "https://dati.emilia-romagna.it/api/3/action/package_search",
    landing: (n) => `https://dati.emilia-romagna.it/dataset/${n}`,
  },
  roma: {
    label: "Roma Capitale",
    api: "https://dati.comune.roma.it/catalog/api/3/action/package_search",
    landing: (n) => `https://dati.comune.roma.it/catalog/dataset/${n}`,
  },
};

/** Resource formats we can preview/load (tabular or geographic). */
const USABLE = /^(csv|json|geojson|xlsx|xls|geopackage|gpkg)$/i;

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, 200);
  const portalId = url.searchParams.get("portal") ?? "nazionale";
  const start = Math.max(0, Number(url.searchParams.get("start") ?? "0") | 0);
  const rows = Math.min(50, Math.max(1, Number(url.searchParams.get("rows") ?? "20") | 0));

  const portal = PORTALS[portalId];
  if (!portal) return json({ error: "Portale non valido." }, 400);

  const api = `${portal.api}?q=${encodeURIComponent(q)}&rows=${rows}&start=${start}`;
  let data: { result?: { count?: number; results?: CkanPackage[] } };
  try {
    const res = await fetch(api, {
      headers: { accept: "application/json", "user-agent": "ZornadeStudio/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return json({ error: `Portale ha risposto ${res.status}.` }, 502);
    data = (await res.json()) as typeof data;
  } catch {
    return json({ error: "Impossibile contattare il portale." }, 502);
  }

  const pkgs = data.result?.results ?? [];
  const results = pkgs
    .map((p) => {
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
        publisher: p.organization?.title ?? portal.label,
        notes: (p.notes ?? "").slice(0, 280),
        landing: portal.landing(p.name ?? ""),
        resources,
      };
    })
    .filter((p) => p.resources.length > 0);

  return json({
    portal: portal.label,
    count: data.result?.count ?? results.length,
    results,
  });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });
}

export const config = { path: "/api/ckan" };

export { PORTALS };
