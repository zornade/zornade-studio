import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseCsv } from "./csv";
import { profileColumns } from "./profile";
import {
  resolveGeoJoin,
  joinChoropleth,
  GEO_LEVELS,
  type GeoLevel,
  type GeoResolution,
} from "./choropleth";
import { evaluateCompatibility } from "./viz-compat";
import { DATASET_CASES } from "./__fixtures__/datasets";

// Load the real geo-key index (built by scripts/build_geo.py).
const here = dirname(fileURLToPath(import.meta.url));
const keysRaw = JSON.parse(
  readFileSync(resolve(here, "../../public/geo/keys.json"), "utf8"),
) as Record<string, string[]>;
const keysByLevel: Record<string, Set<string>> = {};
for (const k of Object.keys(keysRaw)) keysByLevel[k] = new Set(keysRaw[k]);

// Cache of loaded geometries per level (for join-fraction checks).
const geoCache: Record<string, GeoJSON.FeatureCollection> = {};
function loadGeo(level: GeoLevel): GeoJSON.FeatureCollection {
  if (!geoCache[level]) {
    const url = GEO_LEVELS[level].url; // e.g. /geo/regioni.geojson
    geoCache[level] = JSON.parse(
      readFileSync(resolve(here, "../../public", "." + url), "utf8"),
    );
  }
  return geoCache[level];
}

describe("corpus: ingestion → profile → geo-resolve → viz-compat → join", () => {
  for (const c of DATASET_CASES) {
    it(c.name, () => {
      // 1. Parse.
      const { columns, rows } = parseCsv(c.raw);
      expect(columns.length, "column count").toBe(c.expectColumns);
      expect(rows.length, "has rows").toBeGreaterThan(0);

      // 2. Profile.
      const profile = profileColumns(columns, rows);
      if (c.expectTypes) {
        const byName = Object.fromEntries(profile.columns.map((p) => [p.name, p.type]));
        for (const [col, type] of Object.entries(c.expectTypes)) {
          expect(byName[col], `type of ${col}`).toBe(type);
        }
      }

      // 3. Geo-resolution (value-based).
      const resolved = resolveGeoJoin(columns, rows, keysByLevel);
      if (c.expectLevel === null) {
        // Either nothing resolved, or it resolved with a low score we tolerate;
        // the contract is only that a non-geographic dataset is not forced.
        if (resolved) {
          expect(resolved.score, `${c.name}: unexpected strong geo match`).toBeLessThan(0.9);
        }
      } else {
        expect(resolved, `${c.name}: expected a geo resolution`).not.toBeNull();
        expect(resolved!.level).toBe(c.expectLevel);
        if (c.expectKeyColumn) expect(resolved!.keyColumn).toBe(c.expectKeyColumn);
      }

      // 4. Viz compatibility.
      const geoRes: GeoResolution | null =
        c.expectLevel != null
          ? { level: c.expectLevel, keyColumn: c.expectKeyColumn ?? columns[0], score: 1, alternatives: [] }
          : null;
      const compat = evaluateCompatibility(profile, geoRes);
      for (const id of c.expectVizCompatible ?? []) {
        expect(compat[id]?.compatible, `${c.name}: ${id} should be compatible`).toBe(true);
      }
      for (const id of c.expectVizIncompatible ?? []) {
        expect(compat[id]?.compatible, `${c.name}: ${id} should be incompatible`).toBe(false);
      }

      // 5. Join fraction against the real geometry.
      if (c.expectLevel != null && c.expectMinJoinFrac != null) {
        const valueCol =
          profile.columns.find(
            (p) => p.type === "quantitative" && p.name !== c.expectKeyColumn,
          )?.name ?? columns[1];
        const res = joinChoropleth({
          geojson: loadGeo(c.expectLevel),
          level: c.expectLevel,
          rows,
          keyColumn: c.expectKeyColumn ?? columns[0],
          valueColumn: valueCol,
          nClasses: 5,
          method: "quantile",
        });
        const csvKeys = res.matched.length + res.unmatchedCsv.length;
        const frac = csvKeys === 0 ? 0 : res.matched.length / csvKeys;
        expect(frac, `${c.name}: join fraction`).toBeGreaterThanOrEqual(c.expectMinJoinFrac);
      }
    });
  }
});

describe("corpus coverage", () => {
  it("covers every ready geo level at least once", () => {
    const levels = new Set(DATASET_CASES.map((c) => c.expectLevel).filter(Boolean));
    expect(levels.has("paesi")).toBe(true);
    expect(levels.has("regioni")).toBe(true);
    expect(levels.has("province")).toBe(true);
    expect(levels.has("comuni")).toBe(true);
  });
  it("includes non-geographic datasets", () => {
    expect(DATASET_CASES.some((c) => c.expectLevel === null)).toBe(true);
  });
});
