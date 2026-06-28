import { describe, it, expect } from "vitest";
import {
  joinBivariate,
  tercileClass,
  buildBivariateColorExpression,
  BIVARIATE_PALETTE,
  BIVARIATE_PALETTES,
  DEFAULT_BIVARIATE_PALETTE_ID,
  bivariatePaletteColors,
} from "./bivariate";

/** Minimal regioni-like geometry keyed by reg_name. */
function regioni(names: string[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: names.map((n) => ({
      type: "Feature",
      properties: { reg_name: n, reg_istat_code: "" },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    })),
  };
}

describe("tercileClass", () => {
  it("classifies a value against two thresholds", () => {
    const breaks = [10, 20];
    expect(tercileClass(5, breaks)).toBe(0);
    expect(tercileClass(10, breaks)).toBe(0);
    expect(tercileClass(15, breaks)).toBe(1);
    expect(tercileClass(20, breaks)).toBe(1);
    expect(tercileClass(25, breaks)).toBe(2);
  });

  it("returns the middle class when there are no breaks", () => {
    expect(tercileClass(42, [])).toBe(1);
  });
});

describe("joinBivariate", () => {
  const names = ["Lazio", "Lombardia", "Campania", "Veneto", "Sicilia", "Toscana"];
  const geo = regioni(names);
  const rows = names.map((n, i) => ({
    regione: n,
    a: String((i + 1) * 10), // 10..60
    b: String((6 - i) * 10), // 60..10 (inverse)
  }));

  it("assigns a bivariate class 0..8 to every matched area", () => {
    const r = joinBivariate({
      geojson: geo,
      level: "regioni",
      rows,
      keyColumn: "regione",
      columnA: "a",
      columnB: "b",
    });
    expect(r.matched).toBe(6);
    for (const f of r.geojson.features) {
      const biv = (f.properties as Record<string, unknown>).__biv as number;
      expect(biv).toBeGreaterThanOrEqual(0);
      expect(biv).toBeLessThanOrEqual(8);
    }
  });

  it("puts low-A/high-B in the top-left and high-A/low-B in the bottom-right", () => {
    const r = joinBivariate({
      geojson: geo,
      level: "regioni",
      rows,
      keyColumn: "regione",
      columnA: "a",
      columnB: "b",
    });
    const byName: Record<string, number> = {};
    for (const f of r.geojson.features) {
      const p = f.properties as Record<string, unknown>;
      byName[p.reg_name as string] = p.__biv as number;
    }
    // Lazio: a=10 (low col 0), b=60 (high row 2) → 2*3+0 = 6.
    expect(byName.Lazio).toBe(6);
    // Toscana: a=60 (high col 2), b=10 (low row 0) → 0*3+2 = 2.
    expect(byName.Toscana).toBe(2);
  });

  it("leaves an area with a missing value as no-data (no __biv)", () => {
    const r = joinBivariate({
      geojson: geo,
      level: "regioni",
      rows: [
        { regione: "Lazio", a: "10", b: "" }, // missing b
        { regione: "Lombardia", a: "20", b: "30" },
        { regione: "Campania", a: "40", b: "50" },
      ],
      keyColumn: "regione",
      columnA: "a",
      columnB: "b",
    });
    const lazio = r.geojson.features.find(
      (f) => (f.properties as Record<string, unknown>).reg_name === "Lazio",
    )!;
    expect((lazio.properties as Record<string, unknown>).__biv).toBeUndefined();
  });
});

describe("buildBivariateColorExpression", () => {
  it("maps every class to its palette colour with a no-data fallback", () => {
    const expr = buildBivariateColorExpression(BIVARIATE_PALETTE, "#ccc") as unknown[];
    expect(expr[0]).toBe("match");
    expect(expr[expr.length - 1]).toBe("#ccc"); // fallback
    // class 0 → palette[0]
    expect(expr).toContain(BIVARIATE_PALETTE[0]);
    expect(expr).toContain(BIVARIATE_PALETTE[8]);
  });

  it("has a 9-colour palette", () => {
    expect(BIVARIATE_PALETTE).toHaveLength(9);
    for (const c of BIVARIATE_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("BIVARIATE_PALETTES registry", () => {
  it("offers several named 9-colour palettes with unique ids", () => {
    expect(BIVARIATE_PALETTES.length).toBeGreaterThanOrEqual(3);
    const ids = new Set(BIVARIATE_PALETTES.map((p) => p.id));
    expect(ids.size).toBe(BIVARIATE_PALETTES.length);
    for (const p of BIVARIATE_PALETTES) {
      expect(p.colors).toHaveLength(9);
      for (const c of p.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.label.length).toBeGreaterThan(0);
    }
  });

  it("keeps the default palette byte-identical to BIVARIATE_PALETTE (back-compat)", () => {
    expect(DEFAULT_BIVARIATE_PALETTE_ID).toBe(BIVARIATE_PALETTES[0].id);
    expect(bivariatePaletteColors(DEFAULT_BIVARIATE_PALETTE_ID)).toEqual(BIVARIATE_PALETTE);
  });

  it("resolves a known id and falls back to the default for unknown/empty ids", () => {
    const greenBlue = BIVARIATE_PALETTES.find((p) => p.id === "green-blue")!;
    expect(bivariatePaletteColors("green-blue")).toEqual(greenBlue.colors);
    expect(bivariatePaletteColors("")).toEqual(BIVARIATE_PALETTES[0].colors);
    expect(bivariatePaletteColors(undefined)).toEqual(BIVARIATE_PALETTES[0].colors);
    expect(bivariatePaletteColors("does-not-exist")).toEqual(BIVARIATE_PALETTES[0].colors);
  });
});
