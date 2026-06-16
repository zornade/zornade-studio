import { describe, it, expect } from "vitest";
import { featureCentroid } from "./centroid";

describe("featureCentroid", () => {
  it("returns the centroid of a square polygon", () => {
    const sq: GeoJSON.Polygon = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    };
    expect(featureCentroid(sq)).toEqual([1, 1]);
  });

  it("picks the largest polygon of a MultiPolygon", () => {
    const mp: GeoJSON.MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        // tiny island near (10,10)
        [
          [
            [10, 10],
            [10.1, 10],
            [10.1, 10.1],
            [10, 10.1],
            [10, 10],
          ],
        ],
        // big mainland around (0..4, 0..4) → centroid (2,2)
        [
          [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
            [0, 0],
          ],
        ],
      ],
    };
    const c = featureCentroid(mp)!;
    expect(c[0]).toBeCloseTo(2, 6);
    expect(c[1]).toBeCloseTo(2, 6);
  });

  it("returns a Point's own coordinate", () => {
    expect(featureCentroid({ type: "Point", coordinates: [9, 45] })).toEqual([9, 45]);
  });

  it("returns null for unsupported/empty geometry", () => {
    expect(featureCentroid(null)).toBeNull();
    expect(
      featureCentroid({ type: "LineString", coordinates: [[0, 0], [1, 1]] }),
    ).toBeNull();
  });
});
