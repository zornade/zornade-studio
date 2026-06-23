import { describe, it, expect } from "vitest";
import {
  buildSpec,
  serialiseSpec,
  isChoroplethSpec,
  SPEC_SCHEMA_VERSION,
  type BuildSpecResult,
  type ChoroplethSpec,
} from "./spec";
import type { StudioState } from "../studio/types";

/** Narrow a build result to a choropleth (area) spec, or fail the test. */
function area(out: BuildSpecResult): ChoroplethSpec {
  if (!("spec" in out)) throw new Error("expected a spec, got an error");
  if (out.spec.type !== "choropleth") throw new Error("expected a choropleth spec");
  return out.spec;
}

function baseState(overrides: Partial<StudioState> = {}): StudioState {
  return {
    step: "publish",
    project: { title: "Arrivi 2024", subtitle: "per regione", source: "ISTAT" },
    dataSource: "upload",
    vizType: "choropleth",
    preset: "zornade",
    brand: {} as StudioState["brand"],
    design: {
      titleFont: "Inter",
      basemap: "ofm-positron",
      colorScale: "teal-seq",
      reverseScale: false,
      classification: "quantile",
      manualBreaks: [],
      legendType: "steps",
      nClasses: 5,
      valueLabel: "",
      valueUnit: "",
      pointColor: "#01646f",
      pointSize: 7,
      showTitle: true,
      showLegend: true,
      showSource: true,
      tooltip: true,
      tooltipTemplate: "",
      zoomPan: true,
      readerFilters: false,
      chartX: "",
      chartY: "",
      chartSeries: "",
      chartSortByValue: false,
      bivariateColumn2: "",
      cartogramKind: "noncontiguous",
      flowFromLat: "",
      flowFromLon: "",
      flowToLat: "",
      flowToLon: "",
      flowValue: "",
      customBasemapUrl: "", globe: false,
    },
    data: {
      kind: "area",
      fileName: "arrivi.csv",
      columns: ["Regione", "Arrivi"],
      rows: [
        { Regione: "Lombardia", Arrivi: "25794" },
        { Regione: "Veneto", Arrivi: "73890" },
        { Regione: "Lazio", Arrivi: "3.421" },
      ],
      geoLevel: "regioni",
      keyColumn: "Regione",
      valueColumn: "Arrivi",
      numericColumns: ["Arrivi"],
    },
    annotations: [],
    storySteps: [],
    ...overrides,
  };
}

describe("buildSpec", () => {
  it("builds a minimal, versioned choropleth spec", () => {
    const spec = area(buildSpec(baseState()));
    expect(spec.schemaVersion).toBe(SPEC_SCHEMA_VERSION);
    expect(spec.type).toBe("choropleth");
    expect(spec.geo.level).toBe("regioni");
    expect(spec.geo.keyColumn).toBe("Regione");
    // Italian thousands "3.421" → 3421
    expect(spec.data).toEqual([
      { key: "Lombardia", value: 25794 },
      { key: "Veneto", value: 73890 },
      { key: "Lazio", value: 3421 },
    ]);
  });

  it("drops empty and non-numeric rows", () => {
    const s = baseState();
    s.data!.rows = [
      { Regione: "Lombardia", Arrivi: "100" },
      { Regione: "", Arrivi: "200" },
      { Regione: "Lazio", Arrivi: "n.d." },
    ];
    const out = buildSpec(s);
    expect(area(out).data).toEqual([{ key: "Lombardia", value: 100 }]);
  });

  it("collapses duplicate keys (last value wins)", () => {
    const s = baseState();
    s.data!.rows = [
      { Regione: "Lazio", Arrivi: "1" },
      { Regione: "Lazio", Arrivi: "2" },
    ];
    const out = buildSpec(s);
    expect(area(out).data).toEqual([{ key: "Lazio", value: 2 }]);
  });

  it("rejects unsupported viz types with a reason", () => {
    const out = buildSpec(baseState({ vizType: "sankey" }));
    expect("error" in out).toBe(true);
  });

  it("rejects when there is no data", () => {
    const out = buildSpec(baseState({ data: null }));
    expect("error" in out).toBe(true);
  });

  it("rejects when no numeric values exist", () => {
    const s = baseState();
    s.data!.rows = [{ Regione: "Lombardia", Arrivi: "n.d." }];
    expect("error" in buildSpec(s)).toBe(true);
  });
});

describe("buildSpec · temporal (O3.3)", () => {
  function temporalState(): StudioState {
    const s = baseState();
    s.data = {
      kind: "area",
      fileName: "arrivi-temporale.csv",
      columns: ["Regione", "periodo", "Arrivi"],
      rows: [
        { Regione: "Lombardia", periodo: "2020", Arrivi: "100" },
        { Regione: "Lazio", periodo: "2020", Arrivi: "50" },
        { Regione: "Lombardia", periodo: "2021", Arrivi: "120" },
        { Regione: "Lazio", periodo: "2021", Arrivi: "60" },
      ],
      geoLevel: "regioni",
      keyColumn: "Regione",
      valueColumn: "Arrivi",
      numericColumns: ["Arrivi"],
      timeColumn: "periodo",
      timeFrames: ["2020", "2021"],
    };
    return s;
  }

  it("emits time + per-frame data, with the newest frame as the initial data", () => {
    const spec = area(buildSpec(temporalState()));
    expect(spec.time).toEqual({ column: "periodo", frames: ["2020", "2021"] });
    expect(spec.frames).toHaveLength(2);
    expect(spec.frames![0].period).toBe("2020");
    expect(spec.frames![0].data).toEqual([
      { key: "Lombardia", value: 100 },
      { key: "Lazio", value: 50 },
    ]);
    expect(spec.frames![1].data).toEqual([
      { key: "Lombardia", value: 120 },
      { key: "Lazio", value: 60 },
    ]);
    // Initial display = newest frame (2021).
    expect(spec.data).toEqual(spec.frames![1].data);
  });

  it("a non-temporal spec carries no time/frames", () => {
    const spec = area(buildSpec(baseState()));
    expect(spec.time).toBeUndefined();
    expect(spec.frames).toBeUndefined();
  });
});

describe("buildSpec · area maps (O4 publish)", () => {
  it("a plain choropleth omits the render field (byte-compat)", () => {
    const spec = area(buildSpec(baseState()));
    expect(spec.render).toBeUndefined();
  });

  it("symbol/spike/extrusion carry the render kind + value data", () => {
    for (const vizType of ["symbol", "spike", "extrusion"]) {
      const spec = area(buildSpec(baseState({ vizType })));
      expect(spec.render).toBe(vizType);
      expect(spec.type).toBe("choropleth"); // still the area family
      expect(spec.data[0]).toEqual({ key: "Lombardia", value: 25794 });
      expect(spec.design.pointColor).toBe("#01646f");
    }
  });

  it("category map emits {key, category} data + geo.categoryColumn", () => {
    const s = baseState({ vizType: "category" });
    s.data = {
      kind: "area",
      fileName: "macro.csv",
      columns: ["Regione", "Macro"],
      rows: [
        { Regione: "Lombardia", Macro: "Nord" },
        { Regione: "Lazio", Macro: "Centro" },
      ],
      geoLevel: "regioni",
      keyColumn: "Regione",
      valueColumn: "",
      numericColumns: [],
      categoryColumn: "Macro",
    };
    const spec = area(buildSpec(s));
    expect(spec.render).toBe("category");
    expect(spec.geo.categoryColumn).toBe("Macro");
    expect(spec.data).toEqual([
      { key: "Lombardia", category: "Nord" },
      { key: "Lazio", category: "Centro" },
    ]);
  });

  it("category map without a category column errors", () => {
    const out = buildSpec(baseState({ vizType: "category" }));
    expect("error" in out).toBe(true);
  });

  it("bivariate map emits {key, value, value2}", () => {
    const s = baseState({ vizType: "bivariate" });
    s.data = {
      kind: "area",
      fileName: "biv.csv",
      columns: ["Regione", "A", "B"],
      rows: [
        { Regione: "Lombardia", A: "10", B: "100" },
        { Regione: "Lazio", A: "20", B: "200" },
      ],
      geoLevel: "regioni",
      keyColumn: "Regione",
      valueColumn: "A",
      numericColumns: ["A", "B"],
    };
    s.design.bivariateColumn2 = "B";
    const spec = area(buildSpec(s));
    expect(spec.render).toBe("bivariate");
    expect(spec.data).toEqual([
      { key: "Lombardia", value: 10, value2: 100 },
      { key: "Lazio", value: 20, value2: 200 },
    ]);
  });

  it("bivariate with only one numeric column errors", () => {
    const out = buildSpec(baseState({ vizType: "bivariate" }));
    expect("error" in out).toBe(true);
  });

  it("cartogram carries render + cartogramKind", () => {
    const nc = area(buildSpec(baseState({ vizType: "cartogram" })));
    expect(nc.render).toBe("cartogram");
    expect(nc.cartogramKind).toBe("noncontiguous");
    const s = baseState({ vizType: "cartogram" });
    s.design.cartogramKind = "dorling";
    expect(area(buildSpec(s)).cartogramKind).toBe("dorling");
  });

  it("now publishes charts; rejects point maps on an area dataset", () => {
    // Charts work on any data (O4 phase 4): bar on an area dataset → a chart.
    const bar = buildSpec(baseState({ vizType: "bar" }));
    expect("spec" in bar && bar.spec.type === "chart").toBe(true);
    // heatmap is a point map; on an area dataset it can't be built.
    expect("error" in buildSpec(baseState({ vizType: "heatmap" }))).toBe(true);
  });
});

describe("buildSpec · point maps (O4 publish, phase 2)", () => {
  function pointState(vizType: string, rowCount = 3): StudioState {
    const s = baseState({ vizType });
    const rows = Array.from({ length: rowCount }, (_, i) => ({
      citta: `Luogo ${i}`,
      // Keep coordinates inside Italy's range regardless of rowCount.
      lat: String(41 + (i % 50) * 0.02),
      lon: String(12 + (i % 50) * 0.02),
      intensita: String(10 + i),
      categoria: i % 2 === 0 ? "A" : "B",
    }));
    s.data = {
      kind: "point",
      fileName: "punti.csv",
      columns: ["citta", "lat", "lon", "intensita", "categoria"],
      rows,
      numericColumns: ["lat", "lon", "intensita"],
      latColumn: "lat",
      lonColumn: "lon",
      valueColumn: "intensita",
      categoryColumn: "categoria",
      nameColumn: "citta",
    };
    return s;
  }

  it("builds a point spec with inline coordinates", () => {
    const out = buildSpec(pointState("points"));
    if (!("spec" in out) || out.spec.type !== "point") throw new Error("expected point spec");
    const { spec } = out;
    expect(spec.render).toBe("points");
    expect(spec.points).toHaveLength(3);
    expect(spec.points[0]).toMatchObject({ lng: 12, lat: 41, value: 10, category: "A", name: "Luogo 0" });
    expect(spec.fields).toEqual({ name: "citta", value: "intensita", category: "categoria" });
  });

  it("supports every point render kind", () => {
    for (const vizType of ["points", "locator", "heatmap", "hexbin", "dotdensity"]) {
      const out = buildSpec(pointState(vizType));
      if (!("spec" in out) || out.spec.type !== "point") throw new Error(`expected point spec for ${vizType}`);
      expect(out.spec.render).toBe(vizType);
    }
  });

  it("rejects more than MAX_PUBLISH_POINTS points", () => {
    const out = buildSpec(pointState("points", 5001));
    expect("error" in out).toBe(true);
    if ("error" in out) expect(out.error).toMatch(/[Tt]roppi punti/);
  });

  it("rejects a point viz on a non-point dataset", () => {
    const s = baseState({ vizType: "heatmap" }); // area dataset
    expect("error" in buildSpec(s)).toBe(true);
  });
});

describe("buildSpec · flow map (O4 deferred)", () => {
  function flowState(): StudioState {
    const s = baseState({ vizType: "flow" });
    s.data = {
      kind: "table",
      fileName: "flussi.csv",
      columns: ["oLat", "oLon", "dLat", "dLon", "peso"],
      rows: [
        { oLat: "41.9", oLon: "12.5", dLat: "45.5", dLon: "9.2", peso: "100" },
        { oLat: "40.8", oLon: "14.3", dLat: "45.4", dLon: "12.3", peso: "50" },
      ],
      numericColumns: ["oLat", "oLon", "dLat", "dLon", "peso"],
      labelColumns: [],
    };
    s.design.flowFromLat = "oLat";
    s.design.flowFromLon = "oLon";
    s.design.flowToLat = "dLat";
    s.design.flowToLon = "dLon";
    s.design.flowValue = "peso";
    return s;
  }

  it("emits a geo (line) spec with one arc per flow", () => {
    const out = buildSpec(flowState());
    if (!("spec" in out) || out.spec.type !== "geo") throw new Error("expected geo spec");
    expect(out.spec.geometryKinds).toEqual(["line"]);
    expect(out.spec.geojson.features).toHaveLength(2);
    expect(out.spec.geojson.features[0].geometry.type).toBe("LineString");
    expect(out.spec.hasValue).toBe(true);
  });

  it("errors when the origin/destination columns are unset", () => {
    const s = flowState();
    s.design.flowToLon = "";
    expect("error" in buildSpec(s)).toBe(true);
  });
});

describe("buildSpec · custom geometry (O4 publish, phase 3)", () => {
  function geoState(over: Partial<StudioState["data"] & object> = {}): StudioState {
    const s = baseState();
    s.data = {
      kind: "geo",
      fileName: "zone.geojson",
      columns: ["nome", "pop", "tipo"],
      rows: [
        { nome: "Zona A", pop: "100", tipo: "residenziale" },
        { nome: "Zona B", pop: "200", tipo: "industriale" },
      ],
      numericColumns: ["pop"],
      geojson: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { nome: "Zona A", pop: "100", tipo: "residenziale" },
            geometry: { type: "Polygon", coordinates: [[[12, 41], [13, 41], [13, 42], [12, 41]]] },
          },
          {
            type: "Feature",
            properties: { nome: "Zona B", pop: "200", tipo: "industriale" },
            geometry: { type: "Polygon", coordinates: [[[9, 45], [10, 45], [10, 46], [9, 45]]] },
          },
        ],
      },
      geometryKinds: ["polygon"],
      valueColumn: "pop",
      categoryColumn: "tipo",
      nameColumn: "nome",
      ...(over as object),
    } as StudioState["data"];
    return s;
  }

  it("builds a geo spec regardless of vizType (it IS a map)", () => {
    const out = buildSpec(geoState());
    if (!("spec" in out) || out.spec.type !== "geo") throw new Error("expected geo spec");
    const { spec } = out;
    expect(spec.geometryKinds).toEqual(["polygon"]);
    expect(spec.hasValue).toBe(true);
    expect(spec.geojson.features).toHaveLength(2);
    // The prepared geometry carries __value/__name.
    const p0 = spec.geojson.features[0].properties as Record<string, unknown>;
    expect(p0.__value).toBe(100);
    expect(p0.__name).toBe("Zona A");
  });

  it("falls back to category colouring when there is no value column", () => {
    const s = geoState();
    (s.data as { valueColumn: string }).valueColumn = "";
    const out = buildSpec(s);
    if (!("spec" in out) || out.spec.type !== "geo") throw new Error("expected geo spec");
    expect(out.spec.hasValue).toBe(false);
    expect(out.spec.hasCategory).toBe(true);
    expect(out.spec.categories).toEqual(["residenziale", "industriale"]);
  });

  it("rejects an empty geometry", () => {
    const s = geoState();
    (s.data as { geojson: GeoJSON.FeatureCollection }).geojson = {
      type: "FeatureCollection",
      features: [],
    };
    expect("error" in buildSpec(s)).toBe(true);
  });
});

describe("buildSpec · charts (O4 publish, phase 4)", () => {
  function chartState(vizType: string): StudioState {
    const s = baseState({ vizType });
    s.data = {
      kind: "table",
      fileName: "serie.csv",
      columns: ["anno", "valore", "fonte"],
      rows: [
        { anno: "2020", valore: "10", fonte: "A" },
        { anno: "2021", valore: "20", fonte: "A" },
        { anno: "2020", valore: "5", fonte: "B" },
        { anno: "2021", valore: "8", fonte: "B" },
      ],
      numericColumns: ["valore"],
      labelColumns: ["anno", "fonte"],
    };
    s.design.chartX = "anno";
    s.design.chartY = "valore";
    return s;
  }

  it("builds a bar chart spec with precomputed points", () => {
    const out = buildSpec(chartState("bar"));
    if (!("spec" in out) || out.spec.type !== "chart") throw new Error("expected chart spec");
    const { spec } = out;
    expect(spec.render).toBe("bar");
    expect(spec.points).toBeDefined();
    expect(spec.points!.length).toBeGreaterThan(0);
    expect(spec.axisX).toBe("anno");
    expect(spec.colors.length).toBeGreaterThan(0);
  });

  it("carries series when a series column is set", () => {
    const s = chartState("line");
    s.design.chartSeries = "fonte";
    const out = buildSpec(s);
    if (!("spec" in out) || out.spec.type !== "chart") throw new Error("expected chart spec");
    expect(out.spec.hasSeries).toBe(true);
    expect(out.spec.points!.some((p) => p.series === "A")).toBe(true);
  });

  it("builds a table spec carrying columns + rows", () => {
    const out = buildSpec(chartState("table"));
    if (!("spec" in out) || out.spec.type !== "chart") throw new Error("expected chart spec");
    expect(out.spec.render).toBe("table");
    expect(out.spec.table?.columns).toEqual(["anno", "valore", "fonte"]);
    expect(out.spec.table?.rows).toHaveLength(4);
  });

  it("a chart takes priority even on a geo dataset", () => {
    const s = baseState({ vizType: "bar" });
    s.data = {
      kind: "geo",
      fileName: "z.geojson",
      columns: ["nome", "pop"],
      rows: [
        { nome: "A", pop: "10" },
        { nome: "B", pop: "20" },
      ],
      numericColumns: ["pop"],
      geojson: { type: "FeatureCollection", features: [] },
      geometryKinds: ["polygon"],
      valueColumn: "pop",
    } as StudioState["data"];
    s.design.chartX = "nome";
    s.design.chartY = "pop";
    const out = buildSpec(s);
    if (!("spec" in out) || out.spec.type !== "chart") throw new Error("expected chart spec");
    expect(out.spec.render).toBe("bar");
  });
});

describe("serialiseSpec", () => {
  it("is deterministic for equal specs", () => {
    const a = buildSpec(baseState());
    const b = buildSpec(baseState());
    if (!("spec" in a) || !("spec" in b)) throw new Error("expected specs");
    expect(serialiseSpec(a.spec)).toBe(serialiseSpec(b.spec));
  });

  it("round-trips without losing nested data", () => {
    const out = buildSpec(baseState());
    if (!("spec" in out)) throw new Error("expected spec");
    const parsed = JSON.parse(serialiseSpec(out.spec));
    // Nested values must survive (the previous replacer-array bug dropped them).
    expect(parsed.project.title).toBe("Arrivi 2024");
    expect(parsed.data[0]).toEqual({ key: "Lombardia", value: 25794 });
    expect(parsed.design.colorScale).toBe("teal-seq");
    expect(parsed.geo.keyColumn).toBe("Regione");
  });

  it("is stable regardless of key insertion order", () => {
    const spec = area(buildSpec(baseState()));
    // Re-create the same logical spec with shuffled top-level key order.
    const shuffled = {
      type: spec.type,
      data: spec.data,
      design: spec.design,
      schemaVersion: spec.schemaVersion,
      geo: spec.geo,
      project: spec.project,
    } as typeof spec;
    expect(serialiseSpec(shuffled)).toBe(serialiseSpec(spec));
  });
});

describe("isChoroplethSpec", () => {
  it("accepts a built spec and rejects junk", () => {
    const out = buildSpec(baseState());
    if (!("spec" in out)) throw new Error("expected spec");
    expect(isChoroplethSpec(out.spec)).toBe(true);
    expect(isChoroplethSpec(JSON.parse(JSON.stringify(out.spec)))).toBe(true);
    expect(isChoroplethSpec({})).toBe(false);
    expect(isChoroplethSpec(null)).toBe(false);
    expect(isChoroplethSpec({ schemaVersion: 999, type: "choropleth" })).toBe(false);
  });
});

describe("buildSpec · scrollytelling story (O4.1)", () => {
  const steps = [
    { id: "a", title: "Intro", body: "Testo", camera: { center: [12, 42] as [number, number], zoom: 5, pitch: 0, bearing: 0 } },
    { id: "b", title: "Nord", body: "Su", camera: { center: [9, 45] as [number, number], zoom: 7, pitch: 30, bearing: 10 } },
  ];

  it("wraps a base map spec with the ordered steps", () => {
    const out = buildSpec(baseState({ storySteps: steps }));
    if (!("spec" in out) || out.spec.type !== "story") throw new Error("expected story spec");
    expect(out.spec.base.type).toBe("choropleth");
    expect(out.spec.steps).toHaveLength(2);
    expect(out.spec.steps[1].camera.zoom).toBe(7);
  });

  it("ignores steps over a chart (charts have no camera) → publishes the chart", () => {
    const s = baseState({ vizType: "bar", storySteps: steps });
    s.data = {
      kind: "table", fileName: "t.csv", columns: ["a", "b"],
      rows: [{ a: "x", b: "1" }], numericColumns: ["b"], labelColumns: ["a"],
    };
    s.design.chartX = "a";
    s.design.chartY = "b";
    const out = buildSpec(s);
    expect("spec" in out && out.spec.type).toBe("chart");
  });

  it("errors when every step has an invalid camera", () => {
    const bad = [{ id: "x", title: "", body: "", camera: { center: [999, 999] as [number, number], zoom: 5, pitch: 0, bearing: 0 } }];
    expect("error" in buildSpec(baseState({ storySteps: bad }))).toBe(true);
  });

  it("a state with no steps publishes the plain map (not a story)", () => {
    const out = buildSpec(baseState());
    expect("spec" in out && out.spec.type).toBe("choropleth");
  });
});
