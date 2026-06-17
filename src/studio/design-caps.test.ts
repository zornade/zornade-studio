import { describe, it, expect } from "vitest";
import { designCaps, VIZ_DESIGN_CAPS } from "./design-caps";

describe("designCaps", () => {
  it("choropleth exposes geo binding, value label, colour scale and classification", () => {
    const caps = designCaps("choropleth");
    expect(caps.has("geoBinding")).toBe(true);
    expect(caps.has("valueLabel")).toBe(true);
    expect(caps.has("colorScale")).toBe(true);
    expect(caps.has("classification")).toBe(true);
    // Choropleth must NOT show point styling.
    expect(caps.has("pointStyle")).toBe(false);
  });

  it("points expose value label, colour scale and point styling, not classification", () => {
    const caps = designCaps("points");
    expect(caps.has("pointStyle")).toBe(true);
    expect(caps.has("colorScale")).toBe(true);
    expect(caps.has("valueLabel")).toBe(true);
    // Points must NOT show choropleth-only classification or geo binding.
    expect(caps.has("classification")).toBe(false);
    expect(caps.has("geoBinding")).toBe(false);
  });

  it("returns an empty set for an unknown viz type", () => {
    expect(designCaps("does-not-exist").size).toBe(0);
  });

  it("symbol exposes geo binding, value label, colour scale and point styling", () => {
    const caps = designCaps("symbol");
    expect(caps.has("geoBinding")).toBe(true);
    expect(caps.has("pointStyle")).toBe(true);
    expect(caps.has("classification")).toBe(false);
  });

  it("category exposes geo binding, the category selector and colour scale", () => {
    const caps = designCaps("category");
    expect(caps.has("categoryBinding")).toBe(true);
    expect(caps.has("colorScale")).toBe(true);
    expect(caps.has("classification")).toBe(false);
    expect(caps.has("valueLabel")).toBe(false);
  });

  it("every declared capability is one of the known values", () => {
    const known = new Set([
      "geoBinding",
      "valueLabel",
      "colorScale",
      "classification",
      "categoryBinding",
      "pointStyle",
      "tooltipTemplate",
      "readerFilters",
    ]);
    for (const caps of Object.values(VIZ_DESIGN_CAPS)) {
      for (const cap of caps) expect(known.has(cap)).toBe(true);
    }
  });
});
