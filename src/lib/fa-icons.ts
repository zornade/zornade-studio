/**
 * Lazy access to the FontAwesome Free **solid** icon set for the marker icon
 * picker (Design panel). The package (~1.4k icons, CC BY 4.0) is imported only
 * on demand so it never enters the main bundle: the picker calls
 * {@link loadFaIcons} the first time it opens.
 *
 * Each {@link FaIcon} carries the raw SVG path + viewBox dimensions, which the
 * caller bakes into the design (`pointIconPath` / `pointIconW` / `pointIconH`).
 * Rendering (markers.ts, MapPreview, embed) therefore never imports FontAwesome.
 */

export interface FaIcon {
  /** FontAwesome icon name, e.g. "anchor" (also the search key). */
  id: string;
  /** Human label for the picker (id with dashes turned into spaces). */
  label: string;
  /** Raw SVG path data (the `d` attribute). */
  path: string;
  /** Icon viewBox width. */
  width: number;
  /** Icon viewBox height. */
  height: number;
}

let cache: FaIcon[] | null = null;

/** Shape of a FontAwesome `IconDefinition.icon` tuple. */
type FaIconTuple = [number, number, unknown, unknown, string | string[]];

/**
 * Load (and memoise) the full solid icon set, sorted by name. Resolves to an
 * empty list if the dynamic import fails (offline build of a published embed
 * never reaches this code).
 */
export async function loadFaIcons(): Promise<FaIcon[]> {
  if (cache) return cache;
  const mod = (await import("@fortawesome/free-solid-svg-icons")) as Record<
    string,
    unknown
  >;
  const seen = new Set<string>();
  const out: FaIcon[] = [];
  for (const value of Object.values(mod)) {
    const def = value as { iconName?: string; icon?: FaIconTuple };
    if (!def || typeof def !== "object" || !Array.isArray(def.icon)) continue;
    const name = def.iconName;
    if (!name || seen.has(name)) continue;
    const [width, height, , , raw] = def.icon;
    const path = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    if (typeof path !== "string" || !path) continue;
    if (typeof width !== "number" || typeof height !== "number") continue;
    seen.add(name);
    out.push({ id: name, label: name.replace(/-/g, " "), path, width, height });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  cache = out;
  return out;
}

/** Case-insensitive substring filter over icon ids; empty query returns all. */
export function filterFaIcons(icons: FaIcon[], query: string): FaIcon[] {
  const q = query.trim().toLowerCase();
  if (!q) return icons;
  return icons.filter((i) => i.id.includes(q));
}
