/**
 * GET /api/ckan?q=<query>&portal=<id>&start=<n>&rows=<n>
 *
 * Server-side proxy to Italian open-data catalogues. Runs on Netlify so it is
 * not subject to browser CORS: the client calls this same-origin endpoint, we
 * call the portal, and we return a normalised, compact list of datasets that
 * actually have loadable resources.
 *
 * The set of reachable portals is NOT hard-coded here: it comes from the shared
 * registry {@link OPEN_DATA_SOURCES} (single source of truth, also used by the
 * client UI). That registry doubles as the SSRF whitelist - only its entries
 * can be queried. The actual CKAN/Socrata normalisation lives in the shared
 * {@link searchSource} adapter (also exercised by `probe:portals`), so there is
 * a single implementation. Adding a new portal is a one-line registry change.
 *
 * Blacklisted sources (see {@link SOURCE_BLACKLIST}) are rejected.
 */

import { sourceById, isBlacklisted } from "../../src/lib/sources";
import { searchSource, PortalError } from "../../src/lib/catalog-search";

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const portalId = url.searchParams.get("portal") ?? "nazionale";
  const start = Number(url.searchParams.get("start") ?? "0") | 0;
  const rows = Number(url.searchParams.get("rows") ?? "20") | 0;

  const source = sourceById(portalId);
  if (!source) return json({ error: "Portale non valido." }, 400);
  if (isBlacklisted(source.id)) {
    return json({ error: "Questo portale non è attualmente disponibile." }, 404);
  }

  try {
    return json(await searchSource(source, { q, start, rows }));
  } catch (e) {
    const msg = e instanceof PortalError ? e.message : "Impossibile contattare il portale.";
    return json({ error: msg }, 502);
  }
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=300" },
  });
}

export const config = { path: "/api/ckan" };
