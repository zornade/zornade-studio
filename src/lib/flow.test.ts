import { describe, it, expect } from "vitest";
import { buildFlows, arcCoordinates, buildFlowWidthExpression } from "./flow";

const cols = {
  fromLat: "oLat",
  fromLon: "oLon",
  toLat: "dLat",
  toLon: "dLon",
  value: "peso",
  fromName: "origine",
  toName: "destinazione",
};

describe("arcCoordinates", () => {
  it("starts at the origin and ends at the destination", () => {
    const arc = arcCoordinates([12, 42], [9, 45], 0.2, 16);
    expect(arc[0]).toEqual([12, 42]);
    expect(arc[arc.length - 1]).toEqual([9, 45]);
    expect(arc).toHaveLength(17); // segments + 1
  });

  it("bows away from the straight chord midpoint", () => {
    const straight = arcCoordinates([0, 0], [10, 0], 0, 8);
    const bent = arcCoordinates([0, 0], [10, 0], 0.3, 8);
    const midStraight = straight[4];
    const midBent = bent[4];
    // The bent midpoint must be offset perpendicular (in y) from the straight one.
    expect(Math.abs(midBent[1] - midStraight[1])).toBeGreaterThan(0.5);
  });
});

describe("buildFlows", () => {
  const rows = [
    { oLat: "41.9", oLon: "12.5", dLat: "45.5", dLon: "9.2", peso: "100", origine: "Roma", destinazione: "Milano" },
    { oLat: "40.8", oLon: "14.3", dLat: "45.4", dLon: "12.3", peso: "50", origine: "Napoli", destinazione: "Venezia" },
  ];

  it("builds one LineString arc per valid row with __value and labels", () => {
    const r = buildFlows(rows, cols);
    expect(r.geojson.features).toHaveLength(2);
    const f0 = r.geojson.features[0];
    expect(f0.geometry.type).toBe("LineString");
    const p = f0.properties as Record<string, unknown>;
    expect(p.__value).toBe(100);
    expect(p.__name).toBe("Roma → Milano");
    expect(r.valueRange).toEqual({ min: 50, max: 100 });
  });

  it("drops rows with invalid coordinates and counts them", () => {
    const r = buildFlows(
      [
        ...rows,
        { oLat: "999", oLon: "12", dLat: "45", dLon: "9", peso: "1", origine: "x", destinazione: "y" },
      ],
      cols,
    );
    expect(r.geojson.features).toHaveLength(2);
    expect(r.dropped).toBe(1);
  });

  it("works without a value column (no valueRange)", () => {
    const r = buildFlows(rows, { ...cols, value: undefined });
    expect(r.valueRange).toBeUndefined();
    expect(r.geojson.features[0].properties).not.toHaveProperty("__value");
  });
});

describe("buildFlowWidthExpression", () => {
  it("returns a constant when there is no usable range", () => {
    expect(buildFlowWidthExpression(undefined, 1, 8, 3)).toBe(3);
    expect(buildFlowWidthExpression({ min: 5, max: 5 }, 1, 8, 3)).toBe(3);
  });

  it("interpolates width from the value range", () => {
    const expr = buildFlowWidthExpression({ min: 0, max: 100 }, 1, 8, 3) as unknown[];
    expect(expr[0]).toBe("interpolate");
    expect(expr).toContain(100);
    expect(expr).toContain(8);
  });
});
