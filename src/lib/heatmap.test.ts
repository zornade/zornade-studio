import { describe, it, expect } from "vitest";
import { buildHeatmapPaint } from "./heatmap";

describe("buildHeatmapPaint", () => {
  it("produces a transparent-first colour ramp from the palette", () => {
    const paint = buildHeatmapPaint({ colors: ["#aaa", "#555", "#000"] });
    const color = paint["heatmap-color"] as unknown[];
    expect(color[0]).toBe("interpolate");
    // density 0 → transparent
    expect(color[3]).toBe(0);
    expect(color[4]).toBe("rgba(0,0,0,0)");
    // palette colours present
    expect(color).toContain("#aaa");
    expect(color).toContain("#000");
  });

  it("uses a constant weight when no value range is given", () => {
    const paint = buildHeatmapPaint({ colors: ["#000"] });
    expect(paint["heatmap-weight"]).toBe(1);
  });

  it("derives a value-driven weight expression from the range", () => {
    const paint = buildHeatmapPaint({
      colors: ["#000"],
      valueRange: { min: 10, max: 110 },
    });
    const weight = paint["heatmap-weight"] as unknown[];
    expect(weight[0]).toBe("interpolate");
    // reads __value with a coalesce to the min
    expect(JSON.stringify(weight)).toContain("__value");
    expect(weight).toContain(10);
    expect(weight).toContain(110);
  });

  it("ignores a degenerate value range (min == max) → constant weight", () => {
    const paint = buildHeatmapPaint({
      colors: ["#000"],
      valueRange: { min: 5, max: 5 },
    });
    expect(paint["heatmap-weight"]).toBe(1);
  });

  it("scales radius and intensity with zoom", () => {
    const paint = buildHeatmapPaint({ colors: ["#000"], radius: 20, intensity: 1 });
    const radius = paint["heatmap-radius"] as unknown[];
    expect(radius[0]).toBe("interpolate");
    expect(radius).toContain(20); // base radius at zoom 0
  });
});
