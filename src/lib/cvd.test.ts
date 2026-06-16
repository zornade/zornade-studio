import { describe, it, expect } from "vitest";
import {
  simulateCvd,
  simulatePalette,
  colorDistance,
  hexToRgb,
  rgbToHex,
} from "./cvd";
import { COLOR_SCALES, colorsForScale } from "../studio/palettes";

describe("hex/rgb round-trip", () => {
  it("parses and formats hex", () => {
    expect(hexToRgb("#01646f")).toEqual([1, 100, 111]);
    expect(rgbToHex([1, 100, 111])).toBe("#01646f");
    expect(hexToRgb("nope")).toBeNull();
  });
});

describe("simulateCvd", () => {
  it("preserves achromatic (grey) colours under every CVD type", () => {
    // Machado matrix rows sum to 1 → grey maps to (approximately) itself.
    for (const type of ["protanopia", "deuteranopia", "tritanopia"] as const) {
      const out = hexToRgb(simulateCvd("#808080", type))!;
      for (const ch of out) expect(Math.abs(ch - 128)).toBeLessThanOrEqual(1);
    }
  });

  it("returns a valid #rrggbb for any colour", () => {
    expect(simulateCvd("#e53935", "deuteranopia")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("changes a saturated red under protanopia", () => {
    expect(simulateCvd("#ff0000", "protanopia")).not.toBe("#ff0000");
  });

  it("passes through an unparseable colour unchanged", () => {
    expect(simulateCvd("nope", "deuteranopia")).toBe("nope");
  });
});

describe("simulatePalette", () => {
  it("maps every swatch", () => {
    expect(simulatePalette(["#ff0000", "#00ff00"], "deuteranopia")).toHaveLength(2);
  });
});

describe("colorDistance", () => {
  it("is zero for identical colours and large for black vs white", () => {
    expect(colorDistance("#123456", "#123456")).toBe(0);
    expect(colorDistance("#000000", "#ffffff")).toBeGreaterThan(700);
  });
});

describe("curated CVD-safe palettes", () => {
  it("marks the verified palettes as colour-blind-safe", () => {
    for (const id of ["viridis", "ylgnbu", "div-rdbu", "puor", "okabe"]) {
      const s = COLOR_SCALES.find((p) => p.id === id);
      expect(s?.cvdSafe, id).toBe(true);
    }
  });

  it("leaves the generic categorical palette unmarked", () => {
    expect(COLOR_SCALES.find((p) => p.id === "cat")?.cvdSafe).toBeUndefined();
  });
});

describe("colorsForScale reverse", () => {
  it("flips the ramp direction when reverse is true", () => {
    const fwd = colorsForScale("teal-seq");
    const rev = colorsForScale("teal-seq", true);
    expect(rev).toEqual([...fwd].reverse());
    // The original array must not be mutated.
    expect(colorsForScale("teal-seq")).toEqual(fwd);
  });
});
