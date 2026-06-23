import { describe, it, expect } from "vitest";
import { hexbin } from "./hexbin";

describe("hexbin", () => {
  it("returns an empty collection for no points", () => {
    const r = hexbin([]);
    expect(r.geojson.features).toHaveLength(0);
    expect(r.max).toBe(0);
  });

  it("aggregates nearby points into one hexagon", () => {
    // A tight cluster around Rome → all in (at most) one or two cells.
    const pts = Array.from({ length: 20 }, (_, i) => ({
      lng: 12.5 + (i % 5) * 0.001,
      lat: 42.0 + Math.floor(i / 5) * 0.001,
    }));
    const r = hexbin(pts, { cellKm: 50 });
    expect(r.geojson.features.length).toBeLessThanOrEqual(2);
    const total = r.counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(20); // every point counted once
  });

  it("separates distant points into different cells", () => {
    const pts = [
      { lng: 12.5, lat: 42.0 }, // Rome
      { lng: 9.2, lat: 45.4 }, // Milan
      { lng: 15.0, lat: 37.5 }, // Catania
    ];
    const r = hexbin(pts, { cellKm: 30 });
    expect(r.geojson.features.length).toBe(3);
    expect(r.max).toBe(1);
  });

  it("emits closed 6-corner hexagons with a __value", () => {
    const r = hexbin([{ lng: 12, lat: 42 }], { cellKm: 20 });
    const ring = (r.geojson.features[0].geometry as GeoJSON.Polygon).coordinates[0];
    expect(ring).toHaveLength(7); // 6 corners + closing point
    expect(ring[0]).toEqual(ring[6]);
    expect((r.geojson.features[0].properties as Record<string, unknown>).__value).toBe(1);
  });

  it("sums weights when provided", () => {
    const pts = [
      { lng: 12.5, lat: 42.0, weight: 3 },
      { lng: 12.5001, lat: 42.0001, weight: 5 },
    ];
    const r = hexbin(pts, { cellKm: 50 });
    expect(r.max).toBe(8); // 3 + 5 in the same cell
  });

  it("derives a sensible cell size from the extent when none is given", () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({
      lng: 6 + (i % 10) * 0.2,
      lat: 44 + Math.floor(i / 10) * 0.2,
    }));
    const r = hexbin(pts, { targetCols: 10 });
    expect(r.cellKm).toBeGreaterThan(0);
    expect(r.geojson.features.length).toBeGreaterThan(0);
  });
});
