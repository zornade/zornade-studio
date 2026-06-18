import { describe, it, expect } from "vitest";
import {
  chartColumnRoles,
  resolveChartAxes,
  buildChartPoints,
  aggregatePoints,
  sortPointsByValue,
  isChartType,
} from "./chart-data";

const rows = [
  { regione: "Lazio", anno: "2020", arrivi: "1.200", area: "Centro" },
  { regione: "Lazio", anno: "2021", arrivi: "1.500", area: "Centro" },
  { regione: "Lombardia", anno: "2020", arrivi: "2.000", area: "Nord" },
  { regione: "Lombardia", anno: "2021", arrivi: "2.300", area: "Nord" },
];
const columns = ["regione", "anno", "arrivi", "area"];

describe("chartColumnRoles", () => {
  it("splits numeric vs label columns from the profile", () => {
    const roles = chartColumnRoles(columns, rows);
    expect(roles.numericColumns).toContain("arrivi");
    expect(roles.labelColumns).toContain("regione");
    expect(roles.labelColumns).toContain("area");
    // 'anno' is temporal/identifier-ish → a label candidate, not numeric-value.
    expect(roles.numericColumns).not.toContain("regione");
  });
});

describe("resolveChartAxes", () => {
  const roles = { labelColumns: ["regione", "area"], numericColumns: ["arrivi"] };

  it("defaults x to first label and y to first numeric for bar", () => {
    const a = resolveChartAxes("bar", roles, { chartX: "", chartY: "", chartSeries: "" });
    expect(a.x).toBe("regione");
    expect(a.y).toBe("arrivi");
    expect(a.series).toBe("");
  });

  it("defaults x to first numeric for scatter", () => {
    const r2 = { labelColumns: ["regione"], numericColumns: ["arrivi", "spesa"] };
    const a = resolveChartAxes("scatter", r2, { chartX: "", chartY: "", chartSeries: "" });
    expect(a.x).toBe("arrivi");
    expect(a.y).toBe("spesa"); // first numeric not equal to x
  });

  it("honours explicit design choices over defaults", () => {
    const a = resolveChartAxes("bar", roles, {
      chartX: "area",
      chartY: "arrivi",
      chartSeries: "regione",
    });
    expect(a).toEqual({ x: "area", y: "arrivi", series: "regione" });
  });
});

describe("buildChartPoints", () => {
  it("types rows and parses Italian numbers, dropping non-numeric y", () => {
    const pts = buildChartPoints(rows, { x: "regione", y: "arrivi", series: "" });
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual({ x: "Lazio", y: 1200 });
    expect(pts[2]).toEqual({ x: "Lombardia", y: 2000 });
  });

  it("carries the series key when set", () => {
    const pts = buildChartPoints(rows, { x: "anno", y: "arrivi", series: "regione" });
    expect(pts[0]).toEqual({ x: "2020", y: 1200, series: "Lazio" });
  });

  it("parses x as a number for scatter (numericX)", () => {
    const pts = buildChartPoints(rows, { x: "anno", y: "arrivi", series: "" }, { numericX: true });
    expect(pts[0]).toEqual({ x: 2020, y: 1200 });
  });

  it("drops rows with a non-numeric y", () => {
    const dirty = [{ a: "x", b: "n/d" }, { a: "y", b: "5" }];
    const pts = buildChartPoints(dirty, { x: "a", y: "b", series: "" });
    expect(pts).toHaveLength(1);
    expect(pts[0]).toEqual({ x: "y", y: 5 });
  });
});

describe("aggregatePoints", () => {
  it("sums y over repeated (x, series) keeping first-seen order", () => {
    const pts = buildChartPoints(rows, { x: "regione", y: "arrivi", series: "" });
    const agg = aggregatePoints(pts);
    expect(agg).toHaveLength(2);
    expect(agg[0]).toEqual({ x: "Lazio", y: 2700 });
    expect(agg[1]).toEqual({ x: "Lombardia", y: 4300 });
  });

  it("keeps series separate when aggregating", () => {
    const pts = buildChartPoints(rows, { x: "area", y: "arrivi", series: "anno" });
    const agg = aggregatePoints(pts);
    // 2 areas × 2 years = 4 groups.
    expect(agg).toHaveLength(4);
  });
});

describe("sortPointsByValue", () => {
  it("sorts descending by y without mutating the input", () => {
    const pts = [
      { x: "A", y: 1 },
      { x: "B", y: 9 },
      { x: "C", y: 5 },
    ];
    const sorted = sortPointsByValue(pts);
    expect(sorted.map((p) => p.x)).toEqual(["B", "C", "A"]);
    expect(pts[0].x).toBe("A"); // original untouched
  });
});

describe("isChartType", () => {
  it("recognises the chart viz ids", () => {
    expect(isChartType("bar")).toBe(true);
    expect(isChartType("line")).toBe(true);
    expect(isChartType("area")).toBe(true);
    expect(isChartType("scatter")).toBe(true);
    expect(isChartType("choropleth")).toBe(false);
    expect(isChartType("table")).toBe(false);
  });
});
