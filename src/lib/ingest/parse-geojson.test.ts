import { describe, it, expect } from "vitest";
import { parseGeoJson } from "./parse-geojson";

describe("parseGeoJson", () => {
  it("turns a FeatureCollection's properties into a table", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { regione: "Lazio", valore: 10 },
          geometry: { type: "Point", coordinates: [12, 42] },
        },
        {
          type: "Feature",
          properties: { regione: "Veneto", valore: 20 },
          geometry: { type: "Point", coordinates: [11, 45] },
        },
      ],
    };
    const out = parseGeoJson(JSON.stringify(fc));
    expect("error" in out).toBe(false);
    if ("error" in out) return;
    expect(out.columns).toEqual(["regione", "valore"]);
    expect(out.rows).toEqual([
      { regione: "Lazio", valore: "10" },
      { regione: "Veneto", valore: "20" },
    ]);
  });

  it("unions keys across features in first-seen order, filling gaps", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { a: 1 }, geometry: null },
        { type: "Feature", properties: { a: 2, b: 3 }, geometry: null },
      ],
    };
    const out = parseGeoJson(JSON.stringify(fc));
    if ("error" in out) throw new Error(out.error);
    expect(out.columns).toEqual(["a", "b"]);
    expect(out.rows).toEqual([
      { a: "1", b: "" },
      { a: "2", b: "3" },
    ]);
  });

  it("accepts a single Feature", () => {
    const f = {
      type: "Feature",
      properties: { comune: "Forlì", v: 1 },
      geometry: null,
    };
    const out = parseGeoJson(JSON.stringify(f));
    if ("error" in out) throw new Error(out.error);
    expect(out.rows).toEqual([{ comune: "Forlì", v: "1" }]);
  });

  it("accepts a plain array of objects", () => {
    const arr = [
      { sigla: "RM", v: 1 },
      { sigla: "MI", v: 2 },
    ];
    const out = parseGeoJson(JSON.stringify(arr));
    if ("error" in out) throw new Error(out.error);
    expect(out.columns).toEqual(["sigla", "v"]);
    expect(out.rows.length).toBe(2);
  });

  it("stringifies nested values as compact JSON", () => {
    const arr = [{ k: "x", meta: { a: 1 } }];
    const out = parseGeoJson(JSON.stringify(arr));
    if ("error" in out) throw new Error(out.error);
    expect(out.rows[0].meta).toBe('{"a":1}');
  });

  it("reports invalid JSON", () => {
    const out = parseGeoJson("{not json");
    expect("error" in out).toBe(true);
  });

  it("reports an unrecognized shape", () => {
    const out = parseGeoJson(JSON.stringify({ hello: "world" }));
    expect("error" in out).toBe(true);
  });

  it("reports an empty FeatureCollection", () => {
    const out = parseGeoJson(
      JSON.stringify({ type: "FeatureCollection", features: [] }),
    );
    expect("error" in out).toBe(true);
  });
});
