/**
 * Optional self-hosted PMTiles archive URL.
 *
 * Currently the basemap is provided by external OpenFreeMap styles (see
 * MAP_BASEMAPS), so this is only relevant if/when Zornade self-hosts its own
 * basemap tiles. In dev the bundled public/italia.pmtiles is served at
 * /italia.pmtiles; in production set VITE_TILES_URL to a hosted archive.
 */
const ENV_TILES_URL = import.meta.env.VITE_TILES_URL as string | undefined;

export const TILES_URL = ENV_TILES_URL ?? "/italia.pmtiles";

