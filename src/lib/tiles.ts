/**
 * Whether a basemap tiles archive is available to render.
 *
 * In dev the bundled public/italia.pmtiles is served by Vite at /italia.pmtiles,
 * so tiles are available. In production they are only available if
 * VITE_TILES_URL points at a hosted PMTiles archive (e.g. on R2 or Supabase).
 * When neither is true, the app renders data without a basemap (transparent
 * background) instead of failing on a missing pmtiles file.
 */
const ENV_TILES_URL = import.meta.env.VITE_TILES_URL as string | undefined;

export const TILES_AVAILABLE = Boolean(ENV_TILES_URL) || import.meta.env.DEV;
export const TILES_URL = ENV_TILES_URL ?? "/italia.pmtiles";
