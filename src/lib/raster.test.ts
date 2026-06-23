import { describe, it, expect } from "vitest";
import { classifyRasterUrl, buildRasterStyle } from "./raster";

describe("classifyRasterUrl", () => {
  it("recognises XYZ/WMTS templates", () => {
    expect(classifyRasterUrl("https://t/{z}/{x}/{y}.png")).toBe("xyz");
    // WMTS order {z}/{y}/{x} is still XYZ for MapLibre (named placeholders).
    expect(classifyRasterUrl("https://t/wmts/{z}/{y}/{x}.jpg")).toBe("xyz");
  });

  it("recognises WMS GetMap templates", () => {
    expect(
      classifyRasterUrl("https://w/wms?bbox={bbox-epsg-3857}&width=256&height=256"),
    ).toBe("wms");
  });

  it("rejects a plain URL with no tile placeholders", () => {
    expect(classifyRasterUrl("https://example.com/image.png")).toBe("invalid");
  });
});

describe("buildRasterStyle", () => {
  it("builds a single raster source + layer from an XYZ template", () => {
    const style = buildRasterStyle("https://t/{z}/{x}/{y}.png", {
      attribution: "© Esri",
    })!;
    expect(style.version).toBe(8);
    const src = style.sources["raster-bg"] as { type: string; tiles: string[]; attribution?: string };
    expect(src.type).toBe("raster");
    expect(src.tiles[0]).toBe("https://t/{z}/{x}/{y}.png");
    expect(src.attribution).toBe("© Esri");
    expect(style.layers[0]).toMatchObject({ id: "raster-bg", type: "raster", source: "raster-bg" });
  });

  it("honours a custom tile size", () => {
    const style = buildRasterStyle("https://t/{z}/{x}/{y}.png", { tileSize: 512 })!;
    const src = style.sources["raster-bg"] as { tileSize: number };
    expect(src.tileSize).toBe(512);
  });

  it("returns null for an invalid URL", () => {
    expect(buildRasterStyle("https://example.com/nope.png")).toBeNull();
  });
});
