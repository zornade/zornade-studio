import { describe, it, expect } from "vitest";
import {
  mappingFromDataset,
  applyMapping,
  kindsAvailable,
  roleOf,
  type DatasetMapping,
} from "./mapping";
import type {
  AreaDataset,
  PointDataset,
  TableDataset,
  GeoDataset,
} from "../studio/types";

const areaDataset: AreaDataset = {
  kind: "area",
  fileName: "regioni.csv",
  columns: ["regione", "valore", "categoria"],
  rows: [
    { regione: "Lazio", valore: "100", categoria: "A" },
    { regione: "Lombardia", valore: "200", categoria: "B" },
  ],
  numericColumns: ["valore"],
  geoLevel: "regioni",
  keyColumn: "regione",
  valueColumn: "valore",
  categoryColumn: "categoria",
};

const tableDataset: TableDataset = {
  kind: "table",
  fileName: "dati.csv",
  columns: ["comune", "lat", "lon", "valore"],
  rows: [
    { comune: "Roma", lat: "41.9", lon: "12.5", valore: "10" },
    { comune: "Milano", lat: "45.4", lon: "9.2", valore: "20" },
  ],
  numericColumns: ["lat", "lon", "valore"],
  labelColumns: ["comune"],
};

function emptyMapping(kind: DatasetMapping["kind"]): DatasetMapping {
  return {
    kind,
    geoLevel: null,
    keyColumn: null,
    latColumn: null,
    lonColumn: null,
    valueColumn: null,
    categoryColumn: null,
    timeColumn: null,
    nameColumn: null,
  };
}

describe("mappingFromDataset", () => {
  it("reads area bindings", () => {
    const m = mappingFromDataset(areaDataset);
    expect(m.kind).toBe("area");
    expect(m.geoLevel).toBe("regioni");
    expect(m.keyColumn).toBe("regione");
    expect(m.valueColumn).toBe("valore");
    expect(m.categoryColumn).toBe("categoria");
  });

  it("reads point bindings", () => {
    const point: PointDataset = {
      kind: "point",
      fileName: "p.csv",
      columns: ["lat", "lon", "v"],
      rows: [],
      numericColumns: ["v"],
      latColumn: "lat",
      lonColumn: "lon",
      valueColumn: "v",
      nameColumn: "lat",
    };
    const m = mappingFromDataset(point);
    expect(m.kind).toBe("point");
    expect(m.latColumn).toBe("lat");
    expect(m.lonColumn).toBe("lon");
    expect(m.valueColumn).toBe("v");
  });
});

describe("applyMapping", () => {
  it("rebuilds an area dataset from a table mapping", () => {
    const m: DatasetMapping = {
      ...emptyMapping("area"),
      geoLevel: "regioni",
      keyColumn: "comune", // arbitrary key chosen by the operator
      valueColumn: "valore",
    };
    const out = applyMapping(tableDataset, m);
    expect("dataset" in out).toBe(true);
    if ("dataset" in out) {
      expect(out.dataset.kind).toBe("area");
      const a = out.dataset as AreaDataset;
      expect(a.geoLevel).toBe("regioni");
      expect(a.keyColumn).toBe("comune");
      expect(a.valueColumn).toBe("valore");
      expect(a.numericColumns).not.toContain("comune");
    }
  });

  it("errors when the area key or level is missing", () => {
    const out = applyMapping(tableDataset, {
      ...emptyMapping("area"),
      valueColumn: "valore",
    });
    expect("error" in out).toBe(true);
  });

  it("rebuilds a point dataset and excludes lat/lon from numeric candidates", () => {
    const out = applyMapping(tableDataset, {
      ...emptyMapping("point"),
      latColumn: "lat",
      lonColumn: "lon",
      valueColumn: "valore",
    });
    expect("dataset" in out).toBe(true);
    if ("dataset" in out) {
      const p = out.dataset as PointDataset;
      expect(p.kind).toBe("point");
      expect(p.latColumn).toBe("lat");
      expect(p.lonColumn).toBe("lon");
      expect(p.numericColumns).toEqual(["valore"]);
    }
  });

  it("errors when lat and lon are the same column", () => {
    const out = applyMapping(tableDataset, {
      ...emptyMapping("point"),
      latColumn: "lat",
      lonColumn: "lat",
    });
    expect("error" in out).toBe(true);
  });

  it("falls back to a table dataset", () => {
    const out = applyMapping(areaDataset, emptyMapping("table"));
    expect("dataset" in out).toBe(true);
    if ("dataset" in out) {
      expect(out.dataset.kind).toBe("table");
      const t = out.dataset as TableDataset;
      expect(t.numericColumns).toContain("valore");
      expect(t.labelColumns).toContain("regione");
    }
  });

  it("enables the time slider when a period column yields ≥2 frames", () => {
    const wide: TableDataset = {
      kind: "table",
      fileName: "t.csv",
      columns: ["comune", "anno", "valore"],
      rows: [
        { comune: "Roma", anno: "2020", valore: "10" },
        { comune: "Roma", anno: "2021", valore: "12" },
        { comune: "Milano", anno: "2020", valore: "20" },
        { comune: "Milano", anno: "2021", valore: "22" },
      ],
      numericColumns: ["valore"],
      labelColumns: ["comune", "anno"],
    };
    const out = applyMapping(wide, {
      ...emptyMapping("area"),
      geoLevel: "comuni",
      keyColumn: "comune",
      valueColumn: "valore",
      timeColumn: "anno",
    });
    expect("dataset" in out).toBe(true);
    if ("dataset" in out) {
      const a = out.dataset as AreaDataset;
      expect(a.timeColumn).toBe("anno");
      expect(a.timeFrames).toEqual(["2020", "2021"]);
    }
  });

  it("locks an uploaded geometry to the geo kind and only patches bindings", () => {
    const geo: GeoDataset = {
      kind: "geo",
      fileName: "zone.geojson",
      columns: ["nome", "pop"],
      rows: [{ nome: "Z1", pop: "100" }],
      numericColumns: ["pop"],
      geojson: { type: "FeatureCollection", features: [] },
      geometryKinds: ["polygon"],
      valueColumn: "",
    };
    const out = applyMapping(geo, {
      ...emptyMapping("geo"),
      valueColumn: "pop",
      nameColumn: "nome",
    });
    expect("dataset" in out).toBe(true);
    if ("dataset" in out) {
      const g = out.dataset as GeoDataset;
      expect(g.kind).toBe("geo");
      expect(g.valueColumn).toBe("pop");
      expect(g.nameColumn).toBe("nome");
      expect(g.geometryKinds).toEqual(["polygon"]);
    }
  });

  it("refuses to turn a plain table into a geo dataset", () => {
    const out = applyMapping(tableDataset, emptyMapping("geo"));
    expect("error" in out).toBe(true);
  });
});

describe("kindsAvailable", () => {
  it("offers table/area/point for a rich table", () => {
    const k = kindsAvailable(tableDataset);
    expect(k.has("table")).toBe(true);
    expect(k.has("area")).toBe(true);
    expect(k.has("point")).toBe(true);
  });

  it("locks an uploaded geometry to geo", () => {
    const geo: GeoDataset = {
      kind: "geo",
      fileName: "z.geojson",
      columns: ["nome"],
      rows: [],
      numericColumns: [],
      geojson: { type: "FeatureCollection", features: [] },
      geometryKinds: ["polygon"],
      valueColumn: "",
    };
    expect([...kindsAvailable(geo)]).toEqual(["geo"]);
  });

  it("omits point when there is only one numeric column", () => {
    const k = kindsAvailable(areaDataset);
    expect(k.has("point")).toBe(false);
    expect(k.has("area")).toBe(true);
  });
});

describe("roleOf", () => {
  it("maps bound columns to their roles", () => {
    const m = mappingFromDataset(areaDataset);
    const numeric = new Set(["valore"]);
    expect(roleOf("regione", m, numeric)).toBe("geo-key");
    expect(roleOf("valore", m, numeric)).toBe("value");
    expect(roleOf("categoria", m, numeric)).toBe("category");
  });

  it("falls back to numeric/other for unbound columns", () => {
    const m = mappingFromDataset(tableDataset);
    const numeric = new Set(["lat", "lon", "valore"]);
    expect(roleOf("valore", m, numeric)).toBe("numeric");
    expect(roleOf("comune", m, numeric)).toBe("other");
  });
});
