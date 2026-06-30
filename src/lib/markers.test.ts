import { describe, it, expect } from "vitest";
import {
  MARKER_SHAPES,
  MARKER_COLOR_TOKEN,
  isMarkerShape,
  markerAnchor,
  usesMarkerLayer,
  markerViewBox,
  markerSvgTemplate,
  markerImageId,
  markerPixelSize,
} from "./markers";

describe("MARKER_SHAPES", () => {
  it("includes circle first (the default) and the pin", () => {
    expect(MARKER_SHAPES[0].id).toBe("circle");
    expect(MARKER_SHAPES.map((s) => s.id)).toContain("pin");
  });
  it("has unique ids", () => {
    const ids = MARKER_SHAPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("markerAnchor", () => {
  it("anchors the pin at the bottom and others at the centre", () => {
    expect(markerAnchor("pin")).toBe("bottom");
    expect(markerAnchor("circle")).toBe("center");
    expect(markerAnchor("star")).toBe("center");
  });
  it("falls back to centre for unknown shapes", () => {
    expect(markerAnchor("nope")).toBe("center");
  });
});

describe("isMarkerShape", () => {
  it("recognises known shapes only", () => {
    expect(isMarkerShape("hexagon")).toBe(true);
    expect(isMarkerShape("blob")).toBe(false);
  });
});

describe("usesMarkerLayer", () => {
  it("is false for a plain circle with no icon (byte-identical embed)", () => {
    expect(usesMarkerLayer("circle", "")).toBe(false);
    expect(usesMarkerLayer("", "")).toBe(false);
  });
  it("is true for any non-circle shape, or any icon", () => {
    expect(usesMarkerLayer("pin", "")).toBe(true);
    expect(usesMarkerLayer("circle", "M0 0h1v1z")).toBe(true);
  });
});

describe("markerViewBox", () => {
  it("makes the pin taller than wide and others square", () => {
    expect(markerViewBox("pin")).toEqual({ width: 100, height: 140 });
    expect(markerViewBox("square")).toEqual({ width: 100, height: 100 });
  });
});

describe("markerSvgTemplate", () => {
  it("emits a self-contained svg carrying the colour placeholder", () => {
    const svg = markerSvgTemplate("circle");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(MARKER_COLOR_TOKEN);
    expect(svg).toContain("<circle");
    expect(svg).not.toContain("#ffffff\" fill"); // sanity: well-formed
  });
  it("uses a polygon path for the star and a rect for the square", () => {
    expect(markerSvgTemplate("star")).toContain("<path");
    expect(markerSvgTemplate("square")).toContain("<rect");
  });
  it("renders the pin with a viewBox taller than wide", () => {
    expect(markerSvgTemplate("pin")).toContain('viewBox="0 0 100 140"');
  });
  it("embeds the icon path in white when provided", () => {
    const svg = markerSvgTemplate("circle", "M10 10h20v20z", 320, 512);
    expect(svg).toContain("M10 10h20v20z");
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain("scale(");
  });
  it("omits the icon group when no icon is given", () => {
    expect(markerSvgTemplate("hexagon")).not.toContain("scale(");
  });
});

describe("markerImageId", () => {
  it("is stable and distinct per shape/icon/colour/size/dpr", () => {
    const a = markerImageId("pin", "hospital", "#ff0000", 21, 2);
    const b = markerImageId("pin", "hospital", "#00ff00", 21, 2);
    expect(a).not.toBe(b);
    expect(a).toBe(markerImageId("pin", "hospital", "#ff0000", 21, 2));
  });
});

describe("markerPixelSize", () => {
  it("scales with the point size within clamped bounds", () => {
    expect(markerPixelSize(7)).toBe(21);
    expect(markerPixelSize(1)).toBe(14);
    expect(markerPixelSize(100)).toBe(96);
  });
});
