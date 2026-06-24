import { describe, it, expect } from "vitest";
import {
  rectangleRing,
  circleRing,
  arrowBarbs,
  haversineMeters,
  annotationsToGeoJson,
  markerAnnotations,
  sanitizeAnnotations,
  annotationSummary,
  makeMarker,
  makeText,
  makeLine,
  makeArea,
  sameTool,
  DEFAULT_ANNOTATION_COLOR,
  type Annotation,
} from "./annotations";

describe("rectangleRing", () => {
  it("builds a closed 5-point ring from two corners", () => {
    const ring = rectangleRing([0, 0], [2, 4]);
    expect(ring).toEqual([
      [0, 0],
      [2, 0],
      [2, 4],
      [0, 4],
      [0, 0],
    ]);
  });
});

describe("circleRing", () => {
  it("is closed and has steps+1 points", () => {
    const ring = circleRing([12, 42], [12.01, 42], 32);
    expect(ring.length).toBe(33);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("every vertex is roughly the radius away from the centre", () => {
    const center: [number, number] = [12, 42];
    const edge: [number, number] = [12, 42.02];
    const r = haversineMeters(center, edge);
    const ring = circleRing(center, edge, 48);
    for (const p of ring) {
      const d = haversineMeters(center, p);
      // within 1% of the target radius
      expect(Math.abs(d - r) / r).toBeLessThan(0.01);
    }
  });
});

describe("arrowBarbs", () => {
  it("returns two barbs pointing back toward the start, symmetric in latitude", () => {
    const [b1, b2] = arrowBarbs([0, 0], [1, 0]);
    // Both barbs sit behind the tip (x < 1) ...
    expect(b1[0]).toBeLessThan(1);
    expect(b2[0]).toBeLessThan(1);
    // ... and are mirrored across the line (opposite latitudes, same x).
    expect(b1[0]).toBeCloseTo(b2[0], 6);
    expect(b1[1]).toBeCloseTo(-b2[1], 6);
  });
});

describe("annotationsToGeoJson", () => {
  it("emits one LineString for a plain line", () => {
    const fc = annotationsToGeoJson([
      makeLine("l1", [0, 0], [1, 1], "#000000", 3, false),
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe("LineString");
    expect(fc.features[0].properties).toMatchObject({
      __id: "l1",
      __color: "#000000",
      __width: 3,
    });
  });

  it("adds two barb segments for an arrow", () => {
    const fc = annotationsToGeoJson([
      makeLine("l1", [0, 0], [1, 1], "#000000", 3, true),
    ]);
    expect(fc.features).toHaveLength(3);
    expect(fc.features.every((f) => f.geometry.type === "LineString")).toBe(true);
  });

  it("emits a closed Polygon for a rectangle area with opacity", () => {
    const fc = annotationsToGeoJson([
      makeArea("ar1", "rectangle", [0, 0], [2, 2], "#ff0000", 0.3),
    ]);
    expect(fc.features).toHaveLength(1);
    const g = fc.features[0].geometry as GeoJSON.Polygon;
    expect(g.type).toBe("Polygon");
    expect(g.coordinates[0][0]).toEqual(g.coordinates[0][g.coordinates[0].length - 1]);
    expect(fc.features[0].properties).toMatchObject({ __opacity: 0.3 });
  });

  it("emits a many-point Polygon for a circle area", () => {
    const fc = annotationsToGeoJson([
      makeArea("ar2", "circle", [12, 42], [12.01, 42], "#ff0000", 0.3),
    ]);
    const g = fc.features[0].geometry as GeoJSON.Polygon;
    expect(g.coordinates[0].length).toBeGreaterThan(10);
  });

  it("ignores markers and text (rendered as DOM markers)", () => {
    const fc = annotationsToGeoJson([
      makeMarker("m1", 12, 42, "#000", "Roma"),
      makeText("t1", 13, 43, "#000", "ciao"),
    ]);
    expect(fc.features).toHaveLength(0);
  });
});

describe("markerAnnotations", () => {
  it("returns only marker + text descriptors with their label/text", () => {
    const list: Annotation[] = [
      makeMarker("m1", 12, 42, "#111", "Roma"),
      makeText("t1", 13, 43, "#222", "Nota"),
      makeLine("l1", [0, 0], [1, 1], "#000", 3, false),
    ];
    const md = markerAnnotations(list);
    expect(md).toHaveLength(2);
    expect(md[0]).toMatchObject({ id: "m1", type: "marker", text: "Roma" });
    expect(md[1]).toMatchObject({ id: "t1", type: "text", text: "Nota" });
  });
});

describe("sanitizeAnnotations", () => {
  it("returns [] for non-arrays", () => {
    expect(sanitizeAnnotations(null)).toEqual([]);
    expect(sanitizeAnnotations({})).toEqual([]);
  });

  it("drops entries with invalid coordinates", () => {
    const out = sanitizeAnnotations([
      { id: "m1", type: "marker", lng: "x", lat: 42, label: "", color: "#000000" },
      { id: "l1", type: "line", start: [0, 0], end: "nope", color: "#000000", width: 3 },
    ]);
    expect(out).toEqual([]);
  });

  it("keeps valid entries, defaults bad colours and clamps numerics", () => {
    const out = sanitizeAnnotations([
      { id: "m1", type: "marker", lng: 12, lat: 42, label: "Roma", color: "not-a-color" },
      { id: "l1", type: "line", start: [0, 0], end: [1, 1], color: "#abc", width: 999 },
      { id: "a1", type: "area", shape: "circle", a: [0, 0], b: [1, 1], color: "#fff", opacity: 5 },
    ]);
    expect(out).toHaveLength(3);
    expect((out[0] as { color: string }).color).toBe(DEFAULT_ANNOTATION_COLOR);
    expect((out[1] as { width: number }).width).toBe(40);
    expect((out[2] as { opacity: number }).opacity).toBe(1);
  });

  it("assigns an id when missing", () => {
    const out = sanitizeAnnotations([
      { type: "text", lng: 12, lat: 42, text: "x", color: "#000000" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toMatch(/^a_/);
  });
});

describe("annotationSummary", () => {
  it("labels each annotation kind", () => {
    expect(annotationSummary(makeMarker("m", 0, 0, "#000", "Roma"))).toBe("Marker · Roma");
    expect(annotationSummary(makeMarker("m", 0, 0, "#000", ""))).toBe("Marker");
    expect(annotationSummary(makeLine("l", [0, 0], [1, 1], "#000", 3, true))).toBe("Freccia");
    expect(annotationSummary(makeLine("l", [0, 0], [1, 1], "#000", 3, false))).toBe("Linea");
    expect(annotationSummary(makeArea("a", "circle", [0, 0], [1, 1], "#000", 0.3))).toBe(
      "Evidenzia · cerchio",
    );
  });
});

describe("sameTool", () => {
  it("is false against a null armed tool", () => {
    expect(sameTool(null, { kind: "marker" })).toBe(false);
  });

  it("matches simple kinds (marker/text) by kind alone", () => {
    expect(sameTool({ kind: "marker" }, { kind: "marker" })).toBe(true);
    expect(sameTool({ kind: "text" }, { kind: "text" })).toBe(true);
    expect(sameTool({ kind: "marker" }, { kind: "text" })).toBe(false);
  });

  it("discriminates line sub-variants by arrow", () => {
    expect(sameTool({ kind: "line", arrow: true }, { kind: "line", arrow: true })).toBe(true);
    expect(sameTool({ kind: "line", arrow: false }, { kind: "line", arrow: true })).toBe(false);
  });

  it("discriminates area sub-variants by shape", () => {
    expect(
      sameTool({ kind: "area", shape: "circle" }, { kind: "area", shape: "circle" }),
    ).toBe(true);
    expect(
      sameTool({ kind: "area", shape: "rectangle" }, { kind: "area", shape: "circle" }),
    ).toBe(false);
  });
});
