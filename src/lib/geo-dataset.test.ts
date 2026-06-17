import { describe, it, expect } from "vitest";
import {
  buildGeoDataset,
  geometryKinds,
  hasDrawableGeometry,
  prepareGeoRender,
} from "./geo-dataset";

const polygon = (
  props: Record<string, unknown>,
  coords: number[][][] = [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ],
): GeoJSON.Feature => ({
  type: "Feature",
  properties: props,
  geometry: { type: "Polygon", coordinates: coords },
});

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

describe("geometryKinds", () => {
  it("reports distinct primitives in polygon→line→point order", () => {
    const mixed = fc([
      { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [9, 45] } },
      polygon({}),
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
      },
    ]);
    expect(geometryKinds(mixed)).toEqual(["polygon", "line", "point"]);
  });

  it("treats Multi* geometries like their singular kind", () => {
    const multi = fc([
      {
        type: "Feature",
        properties: {},
        geometry: { type: "MultiPolygon", coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]] },
      },
    ]);
    expect(geometryKinds(multi)).toEqual(["polygon"]);
  });
});

describe("hasDrawableGeometry", () => {
  it("is true for a FeatureCollection with polygons", () => {
    expect(hasDrawableGeometry(fc([polygon({})]))).toBe(true);
  });

  it("is true for a single Feature with a line", () => {
    expect(
      hasDrawableGeometry({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
      }),
    ).toBe(true);
  });

  it("is false for a point-only collection (stays on the tabular/point path)", () => {
    expect(
      hasDrawableGeometry(
        fc([
          { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [9, 45] } },
        ]),
      ),
    ).toBe(false);
  });

  it("is false for a plain array or non-geo JSON", () => {
    expect(hasDrawableGeometry([{ a: 1 }])).toBe(false);
    expect(hasDrawableGeometry({ foo: "bar" })).toBe(false);
  });
});

describe("buildGeoDataset", () => {
  it("mirrors properties into a table and detects bindings", () => {
    const out = buildGeoDataset(
      fc([
        polygon({ nome: "Quartiere A", popolazione: "1200", zona: "Nord" }),
        polygon({ nome: "Quartiere B", popolazione: "3400", zona: "Sud" }),
      ]),
      "quartieri.geojson",
    );
    expect("dataset" in out).toBe(true);
    if (!("dataset" in out)) return;
    const d = out.dataset;
    expect(d.kind).toBe("geo");
    expect(d.columns).toEqual(["nome", "popolazione", "zona"]);
    expect(d.rows).toHaveLength(2);
    expect(d.geometryKinds).toEqual(["polygon"]);
    expect(d.numericColumns).toContain("popolazione");
    expect(d.valueColumn).toBe("popolazione"); // first numeric → colours polygons
    expect(d.categoryColumn).toBe("zona"); // categorical
    expect(d.nameColumn).toBe("nome"); // identifier/text label
  });

  it("rejects a collection with no usable geometry", () => {
    const out = buildGeoDataset(
      fc([
        {
          type: "Feature",
          properties: { a: "1" },
          geometry: null as unknown as GeoJSON.Geometry,
        },
      ]),
      "vuoto.geojson",
    );
    expect("error" in out).toBe(true);
  });

  it("handles features with no properties (geometry-only)", () => {
    const out = buildGeoDataset(fc([polygon({})]), "confini.geojson");
    expect("dataset" in out).toBe(true);
    if (!("dataset" in out)) return;
    expect(out.dataset.columns).toEqual([]);
    expect(out.dataset.valueColumn).toBe("");
    expect(out.dataset.geometryKinds).toEqual(["polygon"]);
  });
});

describe("prepareGeoRender", () => {
  it("injects __value/__cat/__name and computes the value range", () => {
    const built = buildGeoDataset(
      fc([
        polygon({ nome: "A", popolazione: "1200", zona: "Nord" }),
        polygon({ nome: "B", popolazione: "3400", zona: "Sud" }),
      ]),
      "q.geojson",
    );
    if (!("dataset" in built)) throw new Error("expected dataset");
    const r = prepareGeoRender(built.dataset);
    expect(r.valueRange).toEqual({ min: 1200, max: 3400 });
    expect(r.categories).toEqual(["Nord", "Sud"]);
    const p0 = r.geojson.features[0].properties as Record<string, unknown>;
    expect(p0.__value).toBe(1200);
    expect(p0.__cat).toBe("Nord");
    expect(p0.__name).toBe("A");
    // Original geometry is preserved.
    expect(r.geojson.features[0].geometry.type).toBe("Polygon");
  });

  it("parses Italian decimals and skips non-numeric values for the range", () => {
    const built = buildGeoDataset(
      fc([
        polygon({ v: "1.234,5" }),
        polygon({ v: "n/d" }),
        polygon({ v: "10" }),
      ]),
      "q.geojson",
    );
    if (!("dataset" in built)) throw new Error("expected dataset");
    const r = prepareGeoRender(built.dataset);
    expect(r.valueRange).toEqual({ min: 10, max: 1234.5 });
  });

  it("carries tooltip extra columns as col:* props", () => {
    const built = buildGeoDataset(
      fc([polygon({ nome: "A", note: "capoluogo", v: "5" })]),
      "q.geojson",
    );
    if (!("dataset" in built)) throw new Error("expected dataset");
    const r = prepareGeoRender(built.dataset, ["note"]);
    const p0 = r.geojson.features[0].properties as Record<string, unknown>;
    expect(p0["col:note"]).toBe("capoluogo");
  });
});
