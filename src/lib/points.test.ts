import { describe, it, expect } from "vitest";
import {
  buildPointFeatures,
  buildPointColorExpression,
  buildPointRadiusExpression,
} from "./points";

describe("buildPointFeatures", () => {
  it("builds [lon, lat] point features from rows", () => {
    const out = buildPointFeatures({
      rows: [
        { lat: "45.46", lon: "9.19", v: "10" },
        { lat: "41.9", lon: "12.5", v: "20" },
      ],
      latColumn: "lat",
      lonColumn: "lon",
      valueColumn: "v",
    });
    expect(out.geojson.features).toHaveLength(2);
    const g0 = out.geojson.features[0].geometry as GeoJSON.Point;
    expect(g0.coordinates).toEqual([9.19, 45.46]);
    expect(out.geojson.features[0].properties!.__value).toBe(10);
    expect(out.valueRange).toEqual({ min: 10, max: 20 });
    expect(out.dropped).toBe(0);
  });

  it("accepts Italian decimal coordinates", () => {
    const out = buildPointFeatures({
      rows: [{ lat: "45,46", lon: "9,19" }],
      latColumn: "lat",
      lonColumn: "lon",
    });
    const g = out.geojson.features[0].geometry as GeoJSON.Point;
    expect(g.coordinates).toEqual([9.19, 45.46]);
  });

  it("drops rows with invalid or out-of-range coordinates", () => {
    const out = buildPointFeatures({
      rows: [
        { lat: "45", lon: "9" },
        { lat: "999", lon: "9" }, // out of range
        { lat: "x", lon: "9" }, // unparseable
        { lat: "", lon: "" }, // empty
      ],
      latColumn: "lat",
      lonColumn: "lon",
    });
    expect(out.geojson.features).toHaveLength(1);
    expect(out.dropped).toBe(3);
  });

  it("collects distinct categories in first-seen order", () => {
    const out = buildPointFeatures({
      rows: [
        { lat: "45", lon: "9", t: "A" },
        { lat: "44", lon: "8", t: "B" },
        { lat: "43", lon: "7", t: "A" },
      ],
      latColumn: "lat",
      lonColumn: "lon",
      categoryColumn: "t",
    });
    expect(out.categories).toEqual(["A", "B"]);
    expect(out.geojson.features[0].properties!.__cat).toBe("A");
  });

  it("omits valueRange when no numeric value column is used", () => {
    const out = buildPointFeatures({
      rows: [{ lat: "45", lon: "9" }],
      latColumn: "lat",
      lonColumn: "lon",
    });
    expect(out.valueRange).toBeUndefined();
  });
});

describe("buildPointColorExpression", () => {
  it("returns a match expression cycling the palette", () => {
    const expr = buildPointColorExpression(["A", "B"], ["#111", "#222"], "#999");
    expect(expr).toEqual([
      "match",
      ["get", "__cat"],
      "A",
      "#111",
      "B",
      "#222",
      "#999",
    ]);
  });

  it("returns the fallback colour with no categories", () => {
    expect(buildPointColorExpression([], ["#111"], "#999")).toBe("#999");
  });
});

describe("buildPointRadiusExpression", () => {
  it("interpolates radius across the value range", () => {
    const expr = buildPointRadiusExpression({ min: 0, max: 100 }, 4, 18, 6);
    expect(Array.isArray(expr)).toBe(true);
    expect((expr as unknown[])[0]).toBe("interpolate");
  });

  it("returns a constant radius without a usable range", () => {
    expect(buildPointRadiusExpression(undefined, 4, 18, 6)).toBe(6);
    expect(buildPointRadiusExpression({ min: 5, max: 5 }, 4, 18, 6)).toBe(6);
  });
});
