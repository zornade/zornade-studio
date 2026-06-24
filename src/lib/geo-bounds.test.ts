import { describe, it, expect } from "vitest";
import { featureCenter, computeBounds } from "./geo-bounds";

describe("featureCenter", () => {
  it("returns null for null/coordinate-less geometry", () => {
    expect(featureCenter(null)).toBeNull();
    expect(
      featureCenter({ type: "GeometryCollection", geometries: [] } as never),
    ).toBeNull();
  });

  it("returns the point itself for a Point", () => {
    expect(
      featureCenter({ type: "Point", coordinates: [12, 42] }),
    ).toEqual([12, 42]);
  });

  it("returns the bbox centre of a Polygon", () => {
    const center = featureCenter({
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    });
    expect(center).toEqual([2, 1]);
  });

  it("spans all parts of a MultiPolygon", () => {
    const center = featureCenter({
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 0],
          ],
        ],
        [
          [
            [8, 8],
            [10, 8],
            [10, 10],
            [8, 8],
          ],
        ],
      ],
    });
    expect(center).toEqual([5, 5]);
  });
});

describe("computeBounds", () => {
  const fc = (
    features: GeoJSON.Feature[],
  ): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features });

  it("returns null when there are no coordinates", () => {
    expect(computeBounds(fc([]))).toBeNull();
  });

  it("computes the bbox across point features", () => {
    const bounds = computeBounds(
      fc([
        {
          type: "Feature",
          properties: { __value: 1 },
          geometry: { type: "Point", coordinates: [9, 45] },
        },
        {
          type: "Feature",
          properties: { __value: 2 },
          geometry: { type: "Point", coordinates: [14, 41] },
        },
      ]),
    );
    expect(bounds).toEqual([
      [9, 41],
      [14, 45],
    ]);
  });

  it("restricts to features carrying a numeric __value when some do", () => {
    const bounds = computeBounds(
      fc([
        {
          type: "Feature",
          properties: { __value: 10 },
          geometry: { type: "Point", coordinates: [0, 0] },
        },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [100, 100] },
        },
      ]),
    );
    expect(bounds).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it("falls back to all features when none carry a value", () => {
    const bounds = computeBounds(
      fc([
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [1, 2] },
        },
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [3, 4] },
        },
      ]),
    );
    expect(bounds).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});
