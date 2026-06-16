import { describe, it, expect } from "vitest";
import { slugify, shortHash, publishKeyPrefix, publishKeys } from "./publish-key";
import { buildSpec } from "./spec";
import type { StudioState } from "../studio/types";

function state(title: string, value: string): StudioState {
  return {
    step: "publish",
    project: { title, subtitle: "", source: "" },
    dataSource: "upload",
    vizType: "choropleth",
    preset: "zornade",
    brand: {} as StudioState["brand"],
    design: {
      titleFont: "Inter", basemap: "ofm-positron", colorScale: "teal-seq",
      reverseScale: false,
      classification: "quantile", manualBreaks: [], legendType: "steps",
      nClasses: 5, valueLabel: "", valueUnit: "", pointColor: "#01646f",
      pointSize: 7, showTitle: true,
      showLegend: true, showSource: true, tooltip: true, zoomPan: true,
    },
    data: {
      kind: "area",
      fileName: "f.csv", columns: ["Regione", "V"],
      rows: [{ Regione: "Lazio", V: value }],
      geoLevel: "regioni", keyColumn: "Regione", valueColumn: "V",
      numericColumns: ["V"],
    },
  };
}

function specOf(title: string, value: string) {
  const out = buildSpec(state(title, value));
  if (!("spec" in out)) throw new Error("expected spec");
  return out.spec;
}

describe("slugify", () => {
  it("makes URL-safe accent-free slugs", () => {
    expect(slugify("Arrivi à Forlì 2024!")).toBe("arrivi-a-forli-2024");
    expect(slugify("")).toBe("mappa");
    expect(slugify("—")).toBe("mappa");
  });
});

describe("shortHash", () => {
  it("is stable and 8 hex chars", () => {
    const h = shortHash("hello");
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(shortHash("hello")).toBe(h);
  });
  it("differs for different input", () => {
    expect(shortHash("a")).not.toBe(shortHash("b"));
  });
});

describe("publishKeyPrefix / publishKeys", () => {
  it("is identical for identical content (idempotent)", () => {
    expect(publishKeyPrefix(specOf("Arrivi 2024", "100"))).toBe(
      publishKeyPrefix(specOf("Arrivi 2024", "100")),
    );
  });
  it("changes when the data changes (immutability)", () => {
    expect(publishKeyPrefix(specOf("Arrivi 2024", "100"))).not.toBe(
      publishKeyPrefix(specOf("Arrivi 2024", "200")),
    );
  });
  it("produces spec.json and index.html under the prefix", () => {
    const k = publishKeys(specOf("Arrivi 2024", "100"));
    expect(k.spec).toBe(`${k.prefix}/spec.json`);
    expect(k.embed).toBe(`${k.prefix}/index.html`);
    expect(k.prefix).toMatch(/^embed\/arrivi-2024\/[0-9a-f]{8}$/);
  });
});
