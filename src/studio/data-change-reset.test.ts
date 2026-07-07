import { describe, it, expect } from "vitest";
import { resetDesignForNewData } from "./data-change-reset";
import type { AreaDataset, DesignSettings, TableDataset } from "./types";

function sampleDesign(overrides: Partial<DesignSettings> = {}): DesignSettings {
  return {
    titleFont: '"Space Grotesk", sans-serif',
    basemap: "ofm-positron",
    colorScale: "teal-seq",
    reverseScale: false,
    classification: "manual",
    manualBreaks: [10, 20, 30],
    legendType: "steps",
    nClasses: 5,
    valueLabel: "Popolazione",
    valueUnit: "ab.",
    valueLabel2: "Reddito",
    valueUnit2: "€",
    pointColor: "#01646f",
    pointSize: 7,
    pointShape: "circle",
    pointIcon: "",
    pointIconPath: "",
    pointIconW: 0,
    pointIconH: 0,
    showTitle: true,
    showLegend: true,
    showSource: true,
    tooltip: true,
    tooltipTemplate: "",
    zoomPan: true,
    readerFilters: false,
    chartX: "anno",
    chartY: "popolazione",
    chartSeries: "regione",
    chartSortByValue: false,
    bivariateColumn2: "reddito",
    bivariatePalette: "",
    cartogramKind: "noncontiguous",
    flowFromLat: "lat_o",
    flowFromLon: "lon_o",
    flowToLat: "lat_d",
    flowToLon: "lon_d",
    flowValue: "peso",
    customBasemapUrl: "",
    hideLabels: false,
    globe: false,
    lockView: false,
    extrusionScale: 1,
    dataOpacity: 1,
    ...overrides,
  };
}

function areaDataset(overrides: Partial<AreaDataset> = {}): AreaDataset {
  return {
    kind: "area",
    fileName: "x.csv",
    columns: ["comune", "popolazione", "anno", "regione", "reddito", "lat_o", "lon_o", "lat_d", "lon_d", "peso"],
    rows: [],
    numericColumns: ["popolazione", "reddito"],
    geoLevel: "comuni",
    keyColumn: "comune",
    valueColumn: "popolazione",
    ...overrides,
  };
}

function tableDataset(overrides: Partial<TableDataset> = {}): TableDataset {
  return {
    kind: "table",
    fileName: "y.csv",
    columns: ["categoria", "totale"],
    rows: [],
    numericColumns: ["totale"],
    labelColumns: ["categoria"],
    ...overrides,
  };
}

describe("resetDesignForNewData", () => {
  it("returns the same design reference on the very first load (prevData null)", () => {
    const design = sampleDesign();
    const out = resetDesignForNewData(design, null, areaDataset());
    expect(out).toBe(design);
  });

  it("always clears manualBreaks on a real replacement, even with identical columns", () => {
    const design = sampleDesign();
    const out = resetDesignForNewData(design, areaDataset(), areaDataset());
    expect(out.manualBreaks).toEqual([]);
  });

  it("keeps valueLabel/valueUnit when the value column name is unchanged", () => {
    const design = sampleDesign();
    const out = resetDesignForNewData(design, areaDataset(), areaDataset({ rows: [{ x: "1" }] }));
    expect(out.valueLabel).toBe("Popolazione");
    expect(out.valueUnit).toBe("ab.");
  });

  it("clears valueLabel/valueUnit when the value column name changes", () => {
    const design = sampleDesign();
    const next = areaDataset({ valueColumn: "reddito", columns: ["comune", "reddito"] });
    const out = resetDesignForNewData(design, areaDataset(), next);
    expect(out.valueLabel).toBe("");
    expect(out.valueUnit).toBe("");
  });

  it("keeps chartX/chartY/chartSeries when their columns still exist in the new dataset", () => {
    const design = sampleDesign();
    const out = resetDesignForNewData(design, areaDataset(), areaDataset());
    expect(out.chartX).toBe("anno");
    expect(out.chartY).toBe("popolazione");
    expect(out.chartSeries).toBe("regione");
  });

  it("clears chartX/chartY/chartSeries whose columns no longer exist", () => {
    const design = sampleDesign();
    const next = tableDataset();
    const out = resetDesignForNewData(design, areaDataset(), next);
    expect(out.chartX).toBe("");
    expect(out.chartY).toBe("");
    expect(out.chartSeries).toBe("");
  });

  it("clears bivariateColumn2 together with valueLabel2/valueUnit2 when the column is gone", () => {
    const design = sampleDesign();
    const next = areaDataset({ columns: ["comune", "popolazione"] });
    const out = resetDesignForNewData(design, areaDataset(), next);
    expect(out.bivariateColumn2).toBe("");
    expect(out.valueLabel2).toBe("");
    expect(out.valueUnit2).toBe("");
  });

  it("keeps bivariateColumn2 and its labels when the column still exists", () => {
    const design = sampleDesign();
    const out = resetDesignForNewData(design, areaDataset(), areaDataset());
    expect(out.bivariateColumn2).toBe("reddito");
    expect(out.valueLabel2).toBe("Reddito");
    expect(out.valueUnit2).toBe("€");
  });

  it("clears flow columns individually when missing from the new dataset", () => {
    const design = sampleDesign();
    const next = areaDataset({ columns: ["comune", "popolazione", "lat_o", "lon_o"] });
    const out = resetDesignForNewData(design, areaDataset(), next);
    expect(out.flowFromLat).toBe("lat_o");
    expect(out.flowFromLon).toBe("lon_o");
    expect(out.flowToLat).toBe("");
    expect(out.flowToLon).toBe("");
    expect(out.flowValue).toBe("");
  });

  it("never touches purely stylistic fields", () => {
    const design = sampleDesign();
    const next = tableDataset();
    const out = resetDesignForNewData(design, areaDataset(), next);
    expect(out.basemap).toBe(design.basemap);
    expect(out.colorScale).toBe(design.colorScale);
    expect(out.pointColor).toBe(design.pointColor);
    expect(out.showTitle).toBe(design.showTitle);
    expect(out.globe).toBe(design.globe);
    expect(out.classification).toBe("manual"); // untouched even though now meaningless w/ empty breaks
  });

  it("keeps a tooltip template that only uses the reserved {nome}/{valore} tokens", () => {
    const design = sampleDesign({ tooltipTemplate: "<b>{nome}</b>: {valore}" });
    const next = tableDataset();
    const out = resetDesignForNewData(design, areaDataset(), next);
    expect(out.tooltipTemplate).toBe("<b>{nome}</b>: {valore}");
  });

  it("clears a tooltip template referencing a column absent from the new dataset", () => {
    const design = sampleDesign({ tooltipTemplate: "{nome}: {reddito}" });
    const next = areaDataset({ columns: ["comune", "popolazione"] });
    const out = resetDesignForNewData(design, areaDataset(), next);
    expect(out.tooltipTemplate).toBe("");
  });

  it("clears every column reference when the dataset is removed entirely (nextData null)", () => {
    const design = sampleDesign();
    const out = resetDesignForNewData(design, areaDataset(), null);
    expect(out.chartX).toBe("");
    expect(out.bivariateColumn2).toBe("");
    expect(out.flowFromLat).toBe("");
    expect(out.valueLabel).toBe("");
    expect(out.manualBreaks).toEqual([]);
  });
});
