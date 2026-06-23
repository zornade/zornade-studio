import { describe, it, expect } from "vitest";
import { nonContiguousCartogram, dorlingCartogram } from "./cartogram";

/** A unit square polygon centred on (cx,cy). */
function square(cx: number, cy: number, value: number): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: { __value: value, __name: `c${cx},${cy}` },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [cx - 0.5, cy - 0.5],
        [cx + 0.5, cy - 0.5],
        [cx + 0.5, cy + 0.5],
        [cx - 0.5, cy + 0.5],
        [cx - 0.5, cy - 0.5],
      ]],
    },
  };
}

/** Bounding-box width of a polygon's first ring. */
function ringWidth(f: GeoJSON.Feature): number {
  const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
  const xs = ring.map((p) => p[0]);
  return Math.max(...xs) - Math.min(...xs);
}

describe("nonContiguousCartogram", () => {
  it("scales the max-value area to full size and smaller values down", () => {
    const fc = nonContiguousCartogram([square(0, 0, 100), square(10, 0, 25)]);
    // value 100 = max → factor 1 → width stays ~1.
    expect(ringWidth(fc.features[0])).toBeCloseTo(1, 5);
    // value 25 → factor √(25/100)=0.5 → width ~0.5.
    expect(ringWidth(fc.features[1])).toBeCloseTo(0.5, 5);
  });

  it("keeps each area centred on its centroid", () => {
    const fc = nonContiguousCartogram([square(10, 5, 25)]);
    const ring = (fc.features[0].geometry as GeoJSON.Polygon).coordinates[0];
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(10, 5);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(5, 5);
  });

  it("passes through features without a numeric value", () => {
    const f: GeoJSON.Feature = {
      type: "Feature",
      properties: { reg: "x" },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    };
    const fc = nonContiguousCartogram([f]);
    expect(fc.features[0]).toEqual(f);
  });
});

describe("dorlingCartogram", () => {
  const inputs = [
    { lng: 12.5, lat: 42.0, value: 100, name: "Roma" },
    { lng: 12.6, lat: 42.0, value: 80, name: "Vicino" }, // close → must be pushed apart
    { lng: 9.2, lat: 45.4, value: 50, name: "Milano" },
  ];

  it("emits one circle polygon per positive value", () => {
    const fc = dorlingCartogram(inputs, { maxRadiusKm: 30 });
    expect(fc.features).toHaveLength(3);
    for (const f of fc.features) {
      expect(f.geometry.type).toBe("Polygon");
      const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
      expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
      expect((f.properties as Record<string, unknown>).__value).toBeTypeOf("number");
    }
  });

  it("sizes circles by √value (bigger value → wider circle)", () => {
    const fc = dorlingCartogram(inputs, { maxRadiusKm: 30, iterations: 0 });
    expect(ringWidth(fc.features[0])).toBeGreaterThan(ringWidth(fc.features[2]));
  });

  it("relaxes overlapping circles apart", () => {
    // Two big circles at nearly the same spot must end up separated.
    const fc = dorlingCartogram(
      [
        { lng: 12.5, lat: 42.0, value: 100, name: "A" },
        { lng: 12.51, lat: 42.0, value: 100, name: "B" },
      ],
      { maxRadiusKm: 50, iterations: 80 },
    );
    const cA = centre(fc.features[0]);
    const cB = centre(fc.features[1]);
    const distKm = Math.hypot(
      (cA[0] - cB[0]) * 110.574 * Math.cos(42 * Math.PI / 180),
      (cA[1] - cB[1]) * 110.574,
    );
    // After relaxation the two centres should be at least ~half the sum of radii apart.
    expect(distKm).toBeGreaterThan(40);
  });

  it("drops non-positive values and handles an empty result", () => {
    expect(dorlingCartogram([{ lng: 0, lat: 0, value: 0 }]).features).toHaveLength(0);
    expect(dorlingCartogram([]).features).toHaveLength(0);
  });
});

/** Centre [lng,lat] of a circle polygon. */
function centre(f: GeoJSON.Feature): [number, number] {
  const ring = (f.geometry as GeoJSON.Polygon).coordinates[0];
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}
