import { describe, it, expect } from "vitest";
import { profileColumn, profileColumns, parsePeriod, THRESHOLDS } from "./profile";

describe("parsePeriod", () => {
  it("recognises common IT/ISO formats with granularity", () => {
    expect(parsePeriod("2024-03-15")?.granularity).toBe("day");
    expect(parsePeriod("15/03/2024")?.granularity).toBe("day");
    expect(parsePeriod("2024")?.granularity).toBe("year");
    expect(parsePeriod("2024 S1")?.granularity).toBe("semester");
    expect(parsePeriod("2024 Q3")?.granularity).toBe("quarter");
    expect(parsePeriod("gen-2024")?.granularity).toBe("month");
  });
  it("rejects non-dates and implausible years", () => {
    expect(parsePeriod("ciao")).toBeNull();
    expect(parsePeriod("1700")).toBeNull();
    expect(parsePeriod("")).toBeNull();
  });
});

describe("profileColumn", () => {
  it("quantitative needs >=85% numeric", () => {
    const vals = ["1", "2", "3", "4", "ciao"]; // 80% numeric → NOT quantitative
    expect(profileColumn("v", vals).type).not.toBe("quantitative");
    const vals2 = ["1.234,5", "2", "3", "4", "5"]; // 100%
    const p = profileColumn("demolizioni", vals2);
    expect(p.type).toBe("quantitative");
    expect(p.stats.min).toBeCloseTo(2);
    expect(p.stats.max).toBeCloseTo(1234.5);
  });

  it("detects temporal year columns over quantitative", () => {
    const p = profileColumn("anno", ["2015", "2016", "2017", "2018"]);
    expect(p.type).toBe("temporal");
    expect(p.temporalGranularity).toBe("year");
  });

  it("detects identifier by name + numeric codes", () => {
    const p = profileColumn("com_istat_code", ["058091", "001001", "082053"]);
    expect(p.type).toBe("identifier");
  });

  it("detects lat/lon by name + range", () => {
    expect(profileColumn("lat", ["41.9", "45.4", "38.1"]).type).toBe("geo-point-lat");
    expect(profileColumn("lon", ["12.5", "9.2", "15.0"]).type).toBe("geo-point-lon");
    // out of range → not geo-point
    expect(profileColumn("lat", ["999", "888", "777"]).type).not.toBe("geo-point-lat");
  });

  it("detects categorical (low cardinality)", () => {
    const rows = Array.from({ length: 200 }, (_, i) => (i % 3 === 0 ? "Comune" : "Provincia"));
    expect(profileColumn("tipoEnteTerritoriale", rows).type).toBe("categorical");
  });

  it("flags empty columns", () => {
    expect(profileColumn("x", ["", "", ""]).type).toBe("empty");
  });
});

describe("profileColumns on ACI-like data", () => {
  it("classifies the ACI demolition columns correctly", () => {
    // Mirror of totale_radiazioni_2024.csv structure.
    const columns = ["tipoEnteTerritoriale", "enteTerritoriale", "provincia", "demolizioni"];
    const rows = [
      { tipoEnteTerritoriale: "Comune", enteTerritoriale: "Agrigento", provincia: "Agrigento", demolizioni: "1049" },
      { tipoEnteTerritoriale: "Comune", enteTerritoriale: "Aragona", provincia: "Agrigento", demolizioni: "120" },
      { tipoEnteTerritoriale: "Provincia", enteTerritoriale: "Milano", provincia: "", demolizioni: "5000" },
    ];
    const { columns: profs } = profileColumns(columns, rows);
    const byName = Object.fromEntries(profs.map((p) => [p.name, p.type]));
    expect(byName.tipoEnteTerritoriale).toBe("categorical");
    expect(byName.demolizioni).toBe("quantitative");
  });
});

describe("THRESHOLDS", () => {
  it("quantitative threshold is stricter than the legacy 0.6", () => {
    expect(THRESHOLDS.quantitative).toBeGreaterThan(0.6);
  });
});
