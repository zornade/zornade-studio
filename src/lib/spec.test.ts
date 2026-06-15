import { describe, it, expect } from "vitest";
import {
  buildSpec,
  serialiseSpec,
  isChoroplethSpec,
  SPEC_SCHEMA_VERSION,
} from "./spec";
import type { StudioState } from "../studio/types";

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
      classification: "quantile",
      manualBreaks: [],
      legendType: "steps",
      nClasses: 5,
      valueLabel: "",
      valueUnit: "",
      showTitle: true,
      showLegend: true,
      showSource: true,
      tooltip: true,
      zoomPan: true,
    },
    data: {
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
    ...overrides,
  };
}

describe("buildSpec", () => {
  it("builds a minimal, versioned choropleth spec", () => {
    const out = buildSpec(baseState());
    expect("spec" in out).toBe(true);
    if (!("spec" in out)) return;
    const { spec } = out;
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
    expect("spec" in out && out.spec.data).toEqual([{ key: "Lombardia", value: 100 }]);
  });

  it("collapses duplicate keys (last value wins)", () => {
    const s = baseState();
    s.data!.rows = [
      { Regione: "Lazio", Arrivi: "1" },
      { Regione: "Lazio", Arrivi: "2" },
    ];
    const out = buildSpec(s);
    expect("spec" in out && out.spec.data).toEqual([{ key: "Lazio", value: 2 }]);
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
    const out = buildSpec(baseState());
    if (!("spec" in out)) throw new Error("expected spec");
    // Re-create the same logical spec with shuffled top-level key order.
    const shuffled = {
      type: out.spec.type,
      data: out.spec.data,
      design: out.spec.design,
      schemaVersion: out.spec.schemaVersion,
      geo: out.spec.geo,
      project: out.spec.project,
    } as typeof out.spec;
    expect(serialiseSpec(shuffled)).toBe(serialiseSpec(out.spec));
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
