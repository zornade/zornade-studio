import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { parseCsv, detectNumericColumns } from "../csv";
import { profileColumns } from "../profile";
import {
  chartColumnRoles,
  resolveChartAxes,
  buildChartPoints,
  aggregatePoints,
} from "../chart-data";

const dir = new URL("../../../examples/", import.meta.url).pathname;
const load = (f: string) => parseCsv(readFileSync(dir + f, "utf8"));
const noDesign = { chartX: "", chartY: "", chartSeries: "" };

describe("example charts end-to-end", () => {
  it("bar: regioni rinnovabili → categoria x, valore y", () => {
    const { columns, rows } = load("grafico-barre-rinnovabili-regioni.csv");
    const roles = chartColumnRoles(columns, rows);
    const axes = resolveChartAxes("bar", roles, noDesign);
    expect(axes.x).toBe("regione");
    expect(axes.y).toBe("produzione_rinnovabile_gwh");
    const pts = aggregatePoints(buildChartPoints(rows, axes));
    expect(pts).toHaveLength(12);
    expect(pts[0]).toEqual({ x: "Lombardia", y: 12800 });
  });

  it("line: rinnovabili per anno con serie=fonte", () => {
    const { columns, rows } = load("grafico-linee-rinnovabili-anni.csv");
    const roles = chartColumnRoles(columns, rows);
    const axes = resolveChartAxes("line", roles, { ...noDesign, chartSeries: "fonte" });
    expect(axes.y).toBe("produzione_twh");
    const pts = buildChartPoints(rows, axes);
    expect(pts.some((p) => p.series === "Solare")).toBe(true);
    expect(pts.some((p) => p.series === "Eolico")).toBe(true);
  });

  it("area: emissioni per anno", () => {
    const { columns, rows } = load("grafico-aree-emissioni-trasporti.csv");
    const roles = chartColumnRoles(columns, rows);
    const axes = resolveChartAxes("area", roles, noDesign);
    expect(axes.y).toBe("emissioni_co2_trasporti_mt");
    const pts = aggregatePoints(buildChartPoints(rows, axes));
    expect(pts).toHaveLength(14);
  });

  it("scatter: due colonne numeriche", () => {
    const { columns, rows } = load("grafico-dispersione-pil-occupazione.csv");
    const roles = chartColumnRoles(columns, rows);
    expect(roles.numericColumns).toContain("pil_procapite_keur");
    expect(roles.numericColumns).toContain("tasso_occupazione_pct");
    const axes = resolveChartAxes("scatter", roles, noDesign);
    const pts = buildChartPoints(rows, axes, { numericX: true });
    expect(pts).toHaveLength(20);
    expect(typeof pts[0].x).toBe("number");
    expect(typeof pts[0].y).toBe("number");
  });

  it("table: settori → solo numeri, nessuna geografia", () => {
    const { columns, rows } = load("grafico-tabella-settori.csv");
    expect(detectNumericColumns(columns, rows).length).toBeGreaterThanOrEqual(4);
    const prof = profileColumns(columns, rows);
    // 'settore' is the label; the rest numeric. No geo-point columns.
    expect(prof.columns.find((c) => c.name === "settore")?.type).not.toBe(
      "quantitative",
    );
  });
});
