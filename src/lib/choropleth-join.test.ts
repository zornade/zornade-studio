import { describe, it, expect } from "vitest";
import {
  joinChoropleth,
  joinCategory,
  matchedFeatureValues,
  computeBreaks,
  normaliseKey,
  type GeoLevel,
} from "./choropleth";

/** Minimal regioni-like geometry with three features keyed by name. */
function geo(names: string[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: names.map((reg_name) => ({
      type: "Feature",
      properties: { reg_name },
      geometry: { type: "Polygon", coordinates: [] },
    })),
  };
}

const LEVEL: GeoLevel = "regioni";

describe("joinChoropleth classification source", () => {
  it("classifies only the values actually rendered on features", () => {
    // Geometry has three regions; the CSV also carries an aggregate "Italia"
    // total whose value (1000) dwarfs the real regions and matches no feature.
    const g = geo(["Lombardia", "Veneto", "Lazio"]);
    const rows = [
      { reg: "Lombardia", v: "10" },
      { reg: "Veneto", v: "20" },
      { reg: "Lazio", v: "30" },
      { reg: "Italia", v: "1000" }, // aggregate row, not a feature
    ];
    const res = joinChoropleth({
      geojson: g,
      level: LEVEL,
      rows,
      keyColumn: "reg",
      valueColumn: "v",
      nClasses: 3,
      method: "quantile",
      manualBreaks: [],
    });
    // The aggregate must not enter the scale: max is the top real region.
    expect(res.classes.max).toBe(30);
    expect(res.classes.min).toBe(10);
    // And it is reported as an unmatched CSV key.
    expect(res.unmatchedCsv).toContain(normaliseKey("Italia"));
  });

  it("would otherwise be skewed: confirms the outlier is excluded", () => {
    const g = geo(["Lombardia", "Veneto", "Lazio"]);
    const rows = [
      { reg: "Lombardia", v: "10" },
      { reg: "Veneto", v: "20" },
      { reg: "Lazio", v: "30" },
      { reg: "Italia", v: "1000" },
    ];
    const matched = matchedFeatureValues(
      g,
      LEVEL,
      new Map(rows.map((r) => [normaliseKey(r.reg), Number(r.v)])),
    );
    expect(matched.sort((a, b) => a - b)).toEqual([10, 20, 30]);
    // Equal breaks over [10..30] → boundaries inside the real range, so the
    // top class (darkest) is reachable by Lazio.
    const c = computeBreaks(matched, "equal", 3, []);
    expect(c.max).toBe(30);
    expect(c.breaks.every((b) => b < 30)).toBe(true);
  });
});

describe("matchedFeatureValues", () => {
  it("returns one value per matched feature, in feature order", () => {
    const g = geo(["Lombardia", "Sardegna", "Veneto"]);
    const v = matchedFeatureValues(
      g,
      LEVEL,
      new Map([
        [normaliseKey("Lombardia"), 1],
        [normaliseKey("Veneto"), 3],
        // Sardegna intentionally absent → no value for that feature.
      ]),
    );
    expect(v).toEqual([1, 3]);
  });
});

describe("joinCategory", () => {
  it("injects __cat on matched features and lists distinct categories", () => {
    const g = geo(["Lombardia", "Veneto", "Lazio"]);
    const res = joinCategory({
      geojson: g,
      level: LEVEL,
      rows: [
        { reg: "Lombardia", area: "Nord" },
        { reg: "Veneto", area: "Nord" },
        { reg: "Lazio", area: "Centro" },
      ],
      keyColumn: "reg",
      categoryColumn: "area",
    });
    expect(res.categories).toEqual(["Nord", "Centro"]);
    expect(res.geojson.features[0].properties!.__cat).toBe("Nord");
    expect(res.geojson.features[2].properties!.__cat).toBe("Centro");
    expect(res.noDataFeatures).toBe(0);
  });

  it("counts features without a category as no-data", () => {
    const g = geo(["Lombardia", "Veneto", "Lazio"]);
    const res = joinCategory({
      geojson: g,
      level: LEVEL,
      rows: [{ reg: "Lombardia", area: "Nord" }],
      keyColumn: "reg",
      categoryColumn: "area",
    });
    expect(res.categories).toEqual(["Nord"]);
    expect(res.noDataFeatures).toBe(2);
    expect(res.geojson.features[1].properties!.__cat).toBeUndefined();
  });
});
