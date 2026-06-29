import { describe, it, expect } from "vitest";
import { skySpec, lightSpec, projectionSpec } from "./map-style";

describe("skySpec", () => {
  it("draws only the atmosphere halo on the globe (transparent space)", () => {
    const sky = skySpec(true) as Record<string, unknown>;
    expect(Object.keys(sky)).toEqual(["atmosphere-blend"]);
    expect(sky["sky-color"]).toBeUndefined();
    expect(sky["fog-color"]).toBeUndefined();
  });

  it("draws a soft horizon gradient on the flat map", () => {
    const sky = skySpec(false) as Record<string, unknown>;
    expect(sky["sky-color"]).toBe("#a9d3ff");
    expect(sky["horizon-color"]).toBe("#eaf3ff");
    expect(sky["fog-color"]).toBe("#ffffff");
    expect(sky["atmosphere-blend"]).toBeDefined();
  });

  it("fades the atmosphere out by zoom 7 in both modes", () => {
    for (const globe of [true, false]) {
      const blend = (skySpec(globe) as Record<string, unknown>)["atmosphere-blend"] as unknown[];
      // ["interpolate", ["linear"], ["zoom"], 0, a, 5, b, 7, 0]
      expect(blend[blend.length - 2]).toBe(7);
      expect(blend[blend.length - 1]).toBe(0);
    }
  });
});

describe("lightSpec", () => {
  it("returns a map-anchored directional light", () => {
    expect(lightSpec()).toEqual({
      anchor: "map",
      color: "#fff7ec",
      intensity: 0.45,
      position: [1.5, 215, 35],
    });
  });
});

describe("projectionSpec", () => {
  it("maps the globe flag to the MapLibre projection type", () => {
    expect(projectionSpec(true)).toEqual({ type: "globe" });
    expect(projectionSpec(false)).toEqual({ type: "mercator" });
  });
});
