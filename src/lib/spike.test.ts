import { describe, it, expect } from "vitest";
import { spikeTriangles } from "./spike";

describe("spikeTriangles", () => {
  const pts = [
    { lng: 12.5, lat: 42.0, value: 100, name: "Roma" },
    { lng: 9.2, lat: 45.4, value: 50, name: "Milano" },
    { lng: 14.2, lat: 40.8, value: 0, name: "Napoli" }, // skipped (zero)
  ];

  it("emits one triangle per positive value, tallest first", () => {
    const fc = spikeTriangles(pts, { maxValue: 100 });
    expect(fc.features).toHaveLength(2); // Napoli (0) dropped
    const names = fc.features.map((f) => (f.properties as Record<string, unknown>).__name);
    expect(names).toEqual(["Roma", "Milano"]); // descending value
  });

  it("builds a closed triangle ring with the apex north of the base", () => {
    const fc = spikeTriangles([pts[0]], { maxValue: 100, maxHeightDeg: 2 });
    const ring = (fc.features[0].geometry as GeoJSON.Polygon).coordinates[0];
    expect(ring).toHaveLength(4);
    expect(ring[0]).toEqual(ring[3]); // closed
    // apex latitude = base lat + height (value/max * maxHeight = 2°)
    expect(ring[2][0]).toBeCloseTo(12.5, 5); // apex centred on lng
    expect(ring[2][1]).toBeCloseTo(44.0, 5); // 42 + 2
  });

  it("scales height proportionally to value", () => {
    const fc = spikeTriangles(
      [
        { lng: 0, lat: 0, value: 100 },
        { lng: 1, lat: 0, value: 25 },
      ],
      { maxValue: 100, maxHeightDeg: 4 },
    );
    const tall = (fc.features[0].geometry as GeoJSON.Polygon).coordinates[0][2][1];
    const short = (fc.features[1].geometry as GeoJSON.Polygon).coordinates[0][2][1];
    expect(tall).toBeCloseTo(4, 5); // 100/100 * 4
    expect(short).toBeCloseTo(1, 5); // 25/100 * 4
  });

  it("carries __value for the tooltip", () => {
    const fc = spikeTriangles([pts[0]], { maxValue: 100 });
    expect((fc.features[0].properties as Record<string, unknown>).__value).toBe(100);
  });

  it("returns an empty collection when all values are non-positive", () => {
    const fc = spikeTriangles([{ lng: 0, lat: 0, value: 0 }], { maxValue: 0 });
    expect(fc.features).toHaveLength(0);
  });
});
