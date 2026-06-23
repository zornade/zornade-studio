import { describe, it, expect } from "vitest";
import { profileColumns } from "./profile";
import { evaluateCompatibility } from "./viz-compat";
import type { GeoResolution } from "./choropleth";

const fakeGeo = (level: GeoResolution["level"], keyColumn: string): GeoResolution => ({
  level,
  keyColumn,
  score: 1,
  alternatives: [],
});

describe("evaluateCompatibility", () => {
  it("region + value → choropleth compatible, scatter not", () => {
    const cols = ["Regione", "Arrivi"];
    const rows = [
      { Regione: "Lombardia", Arrivi: "25794" },
      { Regione: "Veneto", Arrivi: "73890" },
    ];
    const profile = profileColumns(cols, rows);
    const compat = evaluateCompatibility(profile, fakeGeo("regioni", "Regione"));
    expect(compat.choropleth.compatible).toBe(true);
    expect(compat.scatter.compatible).toBe(false); // only 1 quant
    expect(compat.scatter.reason).toMatch(/due colonne numeriche/);
    expect(compat.table.compatible).toBe(true); // always
  });

  it("no geo → choropleth incompatible with a clear reason", () => {
    const cols = ["categoria", "valore"];
    const rows = [
      { categoria: "A", valore: "1" },
      { categoria: "B", valore: "2" },
    ];
    const profile = profileColumns(cols, rows);
    const compat = evaluateCompatibility(profile, null);
    expect(compat.choropleth.compatible).toBe(false);
    expect(compat.choropleth.reason).toMatch(/colonna geografica/);
    // categorical + quantitative → bar/pie compatible
    expect(compat.bar.compatible).toBe(true);
    expect(compat.pie.compatible).toBe(true);
  });

  it("lat/lon → point maps compatible", () => {
    const cols = ["lat", "lon", "nome"];
    const rows = [
      { lat: "41.9", lon: "12.5", nome: "Roma" },
      { lat: "45.4", lon: "9.2", nome: "Milano" },
    ];
    const profile = profileColumns(cols, rows);
    const compat = evaluateCompatibility(profile, null);
    expect(compat.points.compatible).toBe(true);
    expect(compat.heatmap.compatible).toBe(true);
    expect(compat.choropleth.compatible).toBe(false);
  });

  it("temporal + value → time charts compatible", () => {
    const cols = ["anno", "prezzo"];
    const rows = [
      { anno: "2015", prezzo: "1000" },
      { anno: "2016", prezzo: "1100" },
      { anno: "2017", prezzo: "1200" },
    ];
    const profile = profileColumns(cols, rows);
    const compat = evaluateCompatibility(profile, null);
    expect(compat.calendar.compatible).toBe(true);
    expect(compat.barrace.compatible).toBe(true);
    expect(compat.line.compatible).toBe(true);
  });

  it("ACI comuni dataset → choropleth compatible (geo + quant)", () => {
    const cols = ["tipoEnteTerritoriale", "enteTerritoriale", "provincia", "demolizioni"];
    const rows = Array.from({ length: 30 }, (_, i) => ({
      tipoEnteTerritoriale: "Comune",
      enteTerritoriale: `Comune${i}`,
      provincia: "Agrigento",
      demolizioni: String(100 + i),
    }));
    const profile = profileColumns(cols, rows);
    const compat = evaluateCompatibility(profile, fakeGeo("comuni", "enteTerritoriale"));
    expect(compat.choropleth.compatible).toBe(true);
  });

  it("opts.hasGeoPoint forces point maps on even without name-based lat/lon", () => {
    // Columns NOT named lat/lon — the profile alone wouldn't detect points.
    const cols = ["x", "y", "nome"];
    const rows = [
      { x: "41.9", y: "12.5", nome: "Roma" },
      { x: "45.4", y: "9.2", nome: "Milano" },
    ];
    const profile = profileColumns(cols, rows);
    const off = evaluateCompatibility(profile, null);
    expect(off.points.compatible).toBe(false);
    // The committed mapping (Struttura) designated x/y as coordinates.
    const on = evaluateCompatibility(profile, null, { hasGeoPoint: true });
    expect(on.points.compatible).toBe(true);
    expect(on.locator.compatible).toBe(true);
  });

  it("opts.hasGeoArea forces area maps on (committed mapping)", () => {
    const cols = ["zona", "valore"];
    const rows = [
      { zona: "Alfa", valore: "10" },
      { zona: "Beta", valore: "20" },
    ];
    const profile = profileColumns(cols, rows);
    const on = evaluateCompatibility(profile, null, { hasGeoArea: true });
    expect(on.choropleth.compatible).toBe(true);
  });
});

