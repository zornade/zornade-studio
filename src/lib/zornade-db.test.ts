import { describe, it, expect } from "vitest";
import {
  parseDbRequest,
  describeDbRequest,
  dbRowsToTable,
  omiSemesters,
  OMI_TYPES,
  SOLAR_METRICS,
  type DbRow,
} from "./zornade-db";

describe("parseDbRequest", () => {
  it("accepts a valid OMI request", () => {
    const out = parseDbRequest({
      dataset: "omi",
      semestre: "2025_2",
      tipologia: "20",
      market: "compravendita",
    });
    expect(out).toEqual({
      request: {
        dataset: "omi",
        semestre: "2025_2",
        tipologia: "20",
        market: "compravendita",
      },
    });
  });

  it("defaults an unknown market to compravendita", () => {
    const out = parseDbRequest({
      dataset: "omi",
      semestre: "2020_1",
      tipologia: "1",
      market: "boh",
    });
    expect("request" in out && out.request.dataset === "omi" && out.request.market).toBe(
      "compravendita",
    );
  });

  it("rejects an out-of-range or malformed semester (injection-safe whitelist)", () => {
    expect("error" in parseDbRequest({ dataset: "omi", semestre: "2014_1", tipologia: "20" })).toBe(true);
    expect("error" in parseDbRequest({ dataset: "omi", semestre: "2025_3", tipologia: "20" })).toBe(true);
    expect("error" in parseDbRequest({ dataset: "omi", semestre: "x'; DROP--", tipologia: "20" })).toBe(true);
  });

  it("rejects an unknown OMI property type", () => {
    const out = parseDbRequest({ dataset: "omi", semestre: "2025_2", tipologia: "999" });
    expect("error" in out).toBe(true);
  });

  it("accepts a whitelisted solar metric and rejects others", () => {
    expect("request" in parseDbRequest({ dataset: "solar", metric: SOLAR_METRICS[0].id })).toBe(true);
    expect("error" in parseDbRequest({ dataset: "solar", metric: "drop_table" })).toBe(true);
  });

  it("accepts population and buildings, rejects unknown datasets", () => {
    expect("request" in parseDbRequest({ dataset: "population" })).toBe(true);
    expect("request" in parseDbRequest({ dataset: "buildings" })).toBe(true);
    expect("error" in parseDbRequest({ dataset: "parcels" })).toBe(true);
    expect("error" in parseDbRequest(null)).toBe(true);
  });
});

describe("omiSemesters", () => {
  it("lists all 22 semesters newest-first", () => {
    const s = omiSemesters();
    expect(s).toHaveLength(22);
    expect(s[0]).toBe("2025_2");
    expect(s[s.length - 1]).toBe("2015_1");
  });
});

describe("describeDbRequest", () => {
  it("labels OMI purchase vs rent with the right unit", () => {
    const buy = describeDbRequest({
      dataset: "omi",
      semestre: "2025_2",
      tipologia: "20",
      market: "compravendita",
    });
    expect(buy.valueUnit).toBe("€/m²");
    expect(buy.title).toContain("2025/2");

    const rent = describeDbRequest({
      dataset: "omi",
      semestre: "2025_2",
      tipologia: "20",
      market: "locazione",
    });
    expect(rent.valueUnit).toBe("€/m²·mese");
    expect(rent.valueLabel.toLowerCase()).toContain("affitto");
  });

  it("labels solar/population/buildings", () => {
    expect(describeDbRequest({ dataset: "solar", metric: SOLAR_METRICS[0].id }).valueUnit).toBe(
      SOLAR_METRICS[0].unit,
    );
    expect(describeDbRequest({ dataset: "population" }).valueUnit).toBe("ab.");
    expect(describeDbRequest({ dataset: "buildings" }).valueLabel).toBe("Edifici");
  });
});

describe("dbRowsToTable", () => {
  it("maps rows to the codice_istat / comune / valore table", () => {
    const rows: DbRow[] = [
      { istat: "058091", comune: "Roma", value: 3032 },
      { istat: "001272", comune: "Torino", value: 1850 },
    ];
    const t = dbRowsToTable(rows);
    expect(t.columns).toEqual(["codice_istat", "comune", "valore"]);
    expect(t.rows[0]).toEqual({ codice_istat: "058091", comune: "Roma", valore: "3032" });
    expect(t.rows[1].comune).toBe("Torino");
  });
});

describe("OMI_TYPES", () => {
  it("includes the default 'Abitazioni civili' (code 20)", () => {
    expect(OMI_TYPES.find((t) => t.code === "20")?.label).toBe("Abitazioni civili");
  });
});
