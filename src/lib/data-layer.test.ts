import { describe, it, expect } from "vitest";
import { buildDataLayer, type BuildDataLayerArgs } from "./data-layer";
import { GEO_LEVELS } from "./choropleth";
import type { AreaDataset, DesignSettings, PointDataset, GeoDataset } from "../studio/types";

/**
 * Characterization tests for the `buildDataLayer` factory. They pin the branch
 * selection (one per vizType) and the key output fields, so the decomposition
 * out of MapCanvas stays behaviour-preserving. Fixtures are intentionally
 * minimal: each upstream join/aggregation is already covered by its own suite,
 * here we only assert how the factory maps those results to a `DataLayer`.
 */

const fc = (features: GeoJSON.Feature[] = []): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

/** A full DesignSettings with sensible defaults; tests override what matters. */
const design = (over: Partial<DesignSettings> = {}): DesignSettings => ({
  titleFont: "sans-serif",
  basemap: "light",
  colorScale: "teal-seq",
  reverseScale: false,
  classification: "quantile",
  manualBreaks: [],
  legendType: "gradient",
  nClasses: 5,
  valueLabel: "",
  valueUnit: "",
  valueLabel2: "",
  valueUnit2: "",
  pointColor: "#01646f",
  pointSize: 8,
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
  bivariatePalette: "",
  cartogramKind: "noncontiguous",
  flowFromLat: "",
  flowFromLon: "",
  flowToLat: "",
  flowToLon: "",
  flowValue: "",
  customBasemapUrl: "",
  globe: false,
  ...over,
});

const areaData = (over: Partial<AreaDataset> = {}): AreaDataset => ({
  kind: "area",
  fileName: "a.csv",
  columns: ["istat", "valore"],
  rows: [],
  numericColumns: ["valore"],
  geoLevel: "comuni",
  keyColumn: "istat",
  valueColumn: "valore",
  ...over,
});

const pointData = (over: Partial<PointDataset> = {}): PointDataset => ({
  kind: "point",
  fileName: "p.csv",
  columns: ["lat", "lon"],
  rows: [],
  numericColumns: [],
  latColumn: "lat",
  lonColumn: "lon",
  valueColumn: "",
  ...over,
});

const geoData = (over: Partial<GeoDataset> = {}): GeoDataset => ({
  kind: "geo",
  fileName: "g.geojson",
  columns: [],
  rows: [],
  numericColumns: [],
  geojson: fc(),
  geometryKinds: ["polygon"],
  valueColumn: "",
  ...over,
});

const classes = { breaks: [10, 20], min: 0, max: 30 };
const joinResult = { geojson: fc(), matched: [], unmatchedCsv: [], noDataFeatures: 0, classes };

/** Base args with everything null; each test fills only the branch it exercises. */
const base = (over: Partial<BuildDataLayerArgs> = {}): BuildDataLayerArgs => ({
  vizType: "choropleth",
  choro: null,
  joined: null,
  bivariate: null,
  spike: null,
  points: null,
  hexbinResult: null,
  hexbinClasses: null,
  cartogram: null,
  flow: null,
  symbolPoints: null,
  categoryJoin: null,
  geoRender: null,
  scaleColors: ["#e0f3f3", "#01646f"],
  data: null,
  valueLabel: "Valore",
  design: design(),
  catPalette: ["#111", "#222", "#333"],
  ...over,
});

const stub = <T>(v: unknown): T => v as T;

describe("buildDataLayer", () => {
  it("returns null when nothing matches", () => {
    expect(buildDataLayer(base({ vizType: "choropleth", choro: null }))).toBeNull();
  });

  it("choropleth → graduated area fill with the level name field", () => {
    const layer = buildDataLayer(
      base({ vizType: "choropleth", choro: joinResult, data: areaData() }),
    );
    expect(layer?.kind).toBe("area");
    expect(layer?.geojson).toEqual(fc());
    expect(layer?.fillColor).toBeDefined();
    expect(layer?.nameField).toBe(GEO_LEVELS.comuni.nameField);
    expect(layer?.valueLabel).toBe("Valore");
  });

  it("bivariate → area fill from the bivariate palette", () => {
    const layer = buildDataLayer(
      base({
        vizType: "bivariate",
        bivariate: stub({ geojson: fc() }),
        data: areaData(),
      }),
    );
    expect(layer?.kind).toBe("area");
    expect(layer?.fillColor).toBeDefined();
    expect(layer?.nameField).toBe(GEO_LEVELS.comuni.nameField);
  });

  it("spike → area triangles in the point colour", () => {
    const layer = buildDataLayer(
      base({ vizType: "spike", spike: fc(), design: design({ pointColor: "#abc" }) }),
    );
    expect(layer?.kind).toBe("area");
    expect(layer?.fillColor).toBe("#abc");
    expect(layer?.lineColor).toBe("#abc");
    expect(layer?.nameField).toBe("__name");
  });

  it("extrusion → 3D fill with an extrusion range", () => {
    const layer = buildDataLayer(
      base({ vizType: "extrusion", joined: joinResult, data: areaData() }),
    );
    expect(layer?.kind).toBe("extrusion");
    expect(layer?.extrusionRange).toEqual({ min: classes.min, max: classes.max });
    expect(layer?.extrusionMaxHeight).toBeGreaterThan(0);
  });

  it("heatmap → density paint from the point cloud", () => {
    const layer = buildDataLayer(
      base({
        vizType: "heatmap",
        points: stub({ geojson: fc(), dropped: 0, categories: [], valueRange: { min: 0, max: 5 } }),
        data: pointData(),
      }),
    );
    expect(layer?.kind).toBe("heatmap");
    expect(layer?.heatmapPaint).toBeDefined();
  });

  it("hexbin → classified area fill labelled as a count by default", () => {
    const layer = buildDataLayer(
      base({
        vizType: "hexbin",
        hexbinResult: stub({ geojson: fc() }),
        hexbinClasses: classes,
        valueLabel: "",
      }),
    );
    expect(layer?.kind).toBe("area");
    expect(layer?.fillColor).toBeDefined();
    expect(layer?.valueLabel).toBe("Conteggio");
  });

  it("cartogram (non-contiguous) → area keyed by the level name field", () => {
    const layer = buildDataLayer(
      base({
        vizType: "cartogram",
        cartogram: fc(),
        joined: joinResult,
        data: areaData(),
        design: design({ cartogramKind: "noncontiguous" }),
      }),
    );
    expect(layer?.kind).toBe("area");
    expect(layer?.nameField).toBe(GEO_LEVELS.comuni.nameField);
  });

  it("cartogram (dorling) → circles keyed by __name", () => {
    const layer = buildDataLayer(
      base({
        vizType: "cartogram",
        cartogram: fc(),
        joined: joinResult,
        data: areaData(),
        design: design({ cartogramKind: "dorling" }),
      }),
    );
    expect(layer?.nameField).toBe("__name");
  });

  it("flow → geo arcs with a constant colour when no magnitude range", () => {
    const layer = buildDataLayer(
      base({
        vizType: "flow",
        flow: stub({ geojson: fc(), dropped: 0, valueRange: undefined }),
        design: design({ pointColor: "#f50" }),
      }),
    );
    expect(layer?.kind).toBe("geo");
    expect(layer?.lineColorExpr).toBe("#f50");
    expect(layer?.nameField).toBe("__name");
  });

  it("dotdensity → translucent point dots", () => {
    const layer = buildDataLayer(
      base({
        vizType: "dotdensity",
        points: stub({ geojson: fc(), dropped: 0, categories: [] }),
        data: pointData(),
      }),
    );
    expect(layer?.kind).toBe("point");
    expect(layer?.circleOpacity).toBe(0.55);
  });

  it("symbol → sized bubbles keyed by __name", () => {
    const layer = buildDataLayer(
      base({
        vizType: "symbol",
        symbolPoints: { geojson: fc(), valueRange: { min: 0, max: 10 } },
      }),
    );
    expect(layer?.kind).toBe("point");
    expect(layer?.nameField).toBe("__name");
    expect(layer?.circleRadius).toBeDefined();
  });

  it("category → area coloured by category", () => {
    const layer = buildDataLayer(
      base({
        vizType: "category",
        categoryJoin: stub({ geojson: fc(), categories: ["x", "y"], noDataFeatures: 0 }),
        data: areaData({ categoryColumn: "tipo" }),
      }),
    );
    expect(layer?.kind).toBe("area");
    expect(layer?.fillColor).toBeDefined();
    expect(layer?.valueLabel).toBe("tipo");
  });

  it("locator → labelled pins of uniform size", () => {
    const layer = buildDataLayer(
      base({
        vizType: "locator",
        points: stub({ geojson: fc(), dropped: 0, categories: [] }),
        data: pointData(),
      }),
    );
    expect(layer?.kind).toBe("point");
    expect(layer?.showLabels).toBe(true);
  });

  it("plain point dataset (no vizType match) → point layer", () => {
    const layer = buildDataLayer(
      base({
        vizType: "points",
        points: stub({ geojson: fc(), dropped: 0, categories: [], valueRange: { min: 1, max: 9 } }),
        data: pointData(),
      }),
    );
    expect(layer?.kind).toBe("point");
    expect(layer?.circleRadius).toBeDefined();
  });

  it("user geo dataset → geo layer drawing the uploaded geometry", () => {
    const layer = buildDataLayer(
      base({
        vizType: "points",
        geoRender: stub({ geojson: fc(), values: [], categories: [] }),
        data: geoData(),
      }),
    );
    expect(layer?.kind).toBe("geo");
    expect(layer?.circleRadius).toBe(8);
  });

  it("branch order: choropleth wins over a present point dataset", () => {
    const layer = buildDataLayer(
      base({
        vizType: "choropleth",
        choro: joinResult,
        points: stub({ geojson: fc(), dropped: 0, categories: [] }),
        data: areaData(),
      }),
    );
    expect(layer?.kind).toBe("area");
  });
});
