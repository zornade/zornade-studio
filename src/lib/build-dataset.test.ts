import { describe, it, expect } from "vitest";
import { buildDatasetFromCsv, buildDatasetFromTable } from "./build-dataset";

/**
 * Characterization tests for the dataset ingestion core. They pin which shape
 * (point / area / table) a given table resolves to, plus the user-facing error
 * branches. In the test environment `loadGeoKeys` cannot fetch the keys index,
 * so the area path uses name-based geo detection - deterministic and offline.
 */

describe("buildDatasetFromTable", () => {
  it("errors on an empty table", async () => {
    const out = await buildDatasetFromTable({ columns: [], rows: [] }, "x.csv");
    expect(out).toEqual({ error: "Il file sembra vuoto o non leggibile." });
  });

  it("detects a POINT dataset from lat/lon columns", async () => {
    const out = await buildDatasetFromTable(
      {
        columns: ["citta", "lat", "lon", "abitanti"],
        rows: [
          { citta: "Roma", lat: "41.9", lon: "12.5", abitanti: "2800000" },
          { citta: "Milano", lat: "45.5", lon: "9.2", abitanti: "1400000" },
        ],
      },
      "città.csv",
    );
    expect("dataset" in out).toBe(true);
    if (!("dataset" in out)) return;
    const d = out.dataset;
    expect(d.kind).toBe("point");
    if (d.kind !== "point") return;
    expect(d.latColumn).toBe("lat");
    expect(d.lonColumn).toBe("lon");
    expect(d.valueColumn).toBe("abitanti");
    expect(d.nameColumn).toBe("citta");
  });

  it("detects an AREA dataset from a geographic column name", async () => {
    const out = await buildDatasetFromTable(
      {
        columns: ["regione", "valore"],
        rows: [
          { regione: "Lazio", valore: "10" },
          { regione: "Lombardia", valore: "20" },
        ],
      },
      "regioni.csv",
    );
    expect("dataset" in out).toBe(true);
    if (!("dataset" in out)) return;
    const d = out.dataset;
    expect(d.kind).toBe("area");
    if (d.kind !== "area") return;
    expect(d.geoLevel).toBe("regioni");
    expect(d.keyColumn).toBe("regione");
    expect(d.valueColumn).toBe("valore");
  });

  it("errors when an area key has no numeric column to map", async () => {
    const out = await buildDatasetFromTable(
      {
        columns: ["regione", "note"],
        rows: [
          { regione: "Lazio", note: "a" },
          { regione: "Lombardia", note: "b" },
        ],
      },
      "regioni.csv",
    );
    expect(out).toEqual({ error: "Nessuna colonna numerica da mappare trovata." });
  });

  it("falls back to a TABLE dataset when there is no geography", async () => {
    const out = await buildDatasetFromTable(
      {
        columns: ["prodotto", "vendite"],
        rows: [
          { prodotto: "A", vendite: "100" },
          { prodotto: "B", vendite: "200" },
        ],
      },
      "vendite.csv",
    );
    expect("dataset" in out).toBe(true);
    if (!("dataset" in out)) return;
    const d = out.dataset;
    expect(d.kind).toBe("table");
    if (d.kind !== "table") return;
    expect(d.numericColumns).toContain("vendite");
    expect(d.labelColumns).toContain("prodotto");
  });

  it("errors when a non-geographic table has no numeric column", async () => {
    const out = await buildDatasetFromTable(
      {
        columns: ["prodotto", "categoria"],
        rows: [
          { prodotto: "A", categoria: "x" },
          { prodotto: "B", categoria: "y" },
        ],
      },
      "vendite.csv",
    );
    expect("error" in out).toBe(true);
    if (!("error" in out)) return;
    expect(out.error).toContain("Nessuna colonna numerica");
  });

  it("melts a WIDE area table into a temporal choropleth", async () => {
    const out = await buildDatasetFromTable(
      {
        columns: ["regione", "2015", "2016"],
        rows: [
          { regione: "Lazio", "2015": "10", "2016": "12" },
          { regione: "Lombardia", "2015": "20", "2016": "22" },
        ],
      },
      "serie.csv",
    );
    expect("dataset" in out).toBe(true);
    if (!("dataset" in out)) return;
    const d = out.dataset;
    expect(d.kind).toBe("area");
    if (d.kind !== "area") return;
    expect(d.timeColumn).toBe("periodo");
    expect(d.timeFrames).toEqual(["2015", "2016"]);
    expect(d.valueColumn).toBe("valore");
  });
});

describe("buildDatasetFromCsv", () => {
  it("parses CSV text and resolves an area dataset", async () => {
    const out = await buildDatasetFromCsv("regione,valore\nLazio,10\nLombardia,20\n", "r.csv");
    expect("dataset" in out).toBe(true);
    if (!("dataset" in out)) return;
    expect(out.dataset.kind).toBe("area");
  });

  it("returns the empty-file error for blank text", async () => {
    const out = await buildDatasetFromCsv("", "empty.csv");
    expect("error" in out).toBe(true);
  });
});
