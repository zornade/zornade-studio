/**
 * Integration test for the thematic maps (O4.0): runs the EXACT data pipelines
 * that MapCanvas feeds to MapLibre, but against the REAL bundled geometry and
 * the REAL example CSVs — so we verify end-to-end (parse → join → geometry)
 * without needing a WebGL context. This is the strongest check available in a
 * headless environment for the map data flow.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseCsv } from "./csv";
import { joinChoropleth } from "./choropleth";
import { joinBivariate } from "./bivariate";
import { spikeTriangles } from "./spike";
import { hexbin } from "./hexbin";
import { buildHeatmapPaint } from "./heatmap";
import { featureCentroid } from "./centroid";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const readText = (p: string) => readFileSync(resolve(root, p), "utf8");
const regioni = (): GeoJSON.FeatureCollection =>
  JSON.parse(readText("public/geo/regioni.geojson"));

describe("thematic maps · real data integration", () => {
  it("bivariate: joins two columns onto all 20 regions with valid classes", () => {
    const { columns, rows } = parseCsv(readText("examples/regioni-completo.csv"));
    expect(columns).toContain("popolazione");
    expect(columns).toContain("pil_procapite_eur");
    const r = joinBivariate({
      geojson: regioni(),
      level: "regioni",
      rows,
      keyColumn: "regione",
      columnA: "popolazione",
      columnB: "pil_procapite_eur",
    });
    expect(r.matched).toBe(20);
    const classed = r.geojson.features.filter(
      (f) => (f.properties as Record<string, unknown>).__biv !== undefined,
    );
    expect(classed).toHaveLength(20);
    for (const f of classed) {
      const biv = (f.properties as Record<string, unknown>).__biv as number;
      expect(biv).toBeGreaterThanOrEqual(0);
      expect(biv).toBeLessThanOrEqual(8);
    }
  });

  it("spike: builds one triangle per region from real centroids", () => {
    const { rows } = parseCsv(readText("examples/regioni-completo.csv"));
    const joined = joinChoropleth({
      geojson: regioni(),
      level: "regioni",
      rows,
      keyColumn: "regione",
      valueColumn: "popolazione",
      nClasses: 5,
      method: "quantile",
    });
    const inputs: { lng: number; lat: number; value: number }[] = [];
    let max = 0;
    for (const f of joined.geojson.features) {
      const v = (f.properties as Record<string, unknown>).__value;
      if (typeof v !== "number") continue;
      const c = featureCentroid(f.geometry);
      if (!c) continue;
      if (v > max) max = v;
      inputs.push({ lng: c[0], lat: c[1], value: v });
    }
    expect(inputs).toHaveLength(20);
    const fc = spikeTriangles(inputs, { maxValue: max });
    expect(fc.features).toHaveLength(20);
    // Every centroid must sit within Italy's bounding box.
    for (const f of fc.features) {
      const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
      const [lng, lat] = ring[0];
      expect(lng).toBeGreaterThan(6);
      expect(lng).toBeLessThan(19);
      expect(lat).toBeGreaterThan(35);
      expect(lat).toBeLessThan(47.5);
    }
  });

  it("hexbin + heatmap: aggregate the real 487-point event cloud", () => {
    const { columns, rows } = parseCsv(readText("examples/eventi-punti-italia.csv"));
    expect(columns).toEqual(["lat", "lon", "citta", "categoria", "intensita"]);
    const pts = rows.map((r) => ({
      lng: Number(r.lon),
      lat: Number(r.lat),
    }));
    expect(pts.length).toBeGreaterThan(400);

    const h = hexbin(pts, { targetCols: 22 });
    expect(h.geojson.features.length).toBeGreaterThan(0);
    // Total binned count equals the number of points (nothing lost/duplicated).
    const total = h.counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(pts.length);
    expect(h.max).toBeGreaterThan(1); // clusters → cells with multiple points

    // Heatmap paint with the intensity range present in the file.
    const intens = rows.map((r) => Number(r.intensita)).filter(Number.isFinite);
    const range = { min: Math.min(...intens), max: Math.max(...intens) };
    const paint = buildHeatmapPaint({ valueRange: range, colors: ["#aaa", "#000"] });
    expect(paint["heatmap-color"]).toBeTruthy();
    expect(paint["heatmap-weight"]).not.toBe(1); // a real range → value-driven
  });
});
