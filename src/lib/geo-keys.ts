/**
 * Loader for the value-based geo-key index (`public/geo/keys.json`).
 *
 * The index holds the normalised join keys of every ready geo level and powers
 * {@link resolveGeoJoin} - telling apart, by actual data values, a comune
 * dataset from its parent-province context column. It is fetched once and
 * cached; if it is unavailable the caller falls back to name-based detection.
 */

let cache: Record<string, Set<string>> | null = null;
let inflight: Promise<Record<string, Set<string>>> | null = null;

export async function loadGeoKeys(): Promise<Record<string, Set<string>>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = fetch("/geo/keys.json")
    .then((r) =>
      r.ok
        ? (r.json() as Promise<Record<string, string[]>>)
        : ({} as Record<string, string[]>),
    )
    .then((raw) => {
      const out: Record<string, Set<string>> = {};
      for (const level of Object.keys(raw)) out[level] = new Set(raw[level]);
      cache = out;
      return out;
    })
    .catch(() => ({}) as Record<string, Set<string>>);
  return inflight;
}
