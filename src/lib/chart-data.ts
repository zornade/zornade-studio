/**
 * Chart data preparation (ROADMAP O3.2).
 *
 * Charts (bar/line/area/scatter) and the rich table render from the dataset's
 * plain `columns`/`rows`. This module is the **pure**, tested core that:
 *  - picks sensible default axes from the column profile,
 *  - turns string rows into typed points (parsing Italian numbers),
 *  - aggregates by category for bar/line/area,
 * so the React `ChartCanvas` stays a thin Observable Plot wrapper.
 *
 * It is engine-agnostic: it returns plain arrays of `{ x, y, series }` (or the
 * raw rows for the table), never Plot marks - the renderer maps those to marks.
 */

import { parseNumber } from "./csv";
import { profileColumns } from "./profile";

/** A single chart datum after typing/aggregation. */
export interface ChartPoint {
  /** X value: a category/time label (bar/line/area) or a number (scatter). */
  x: string | number;
  /** Y value: numeric. */
  y: number;
  /** Optional series/colour key. */
  series?: string;
}

export interface ChartAxes {
  /** Column used for the x-axis. */
  x: string;
  /** Column used for the y-axis (numeric). */
  y: string;
  /** Optional column splitting into series. "" = none. */
  series: string;
}

/** Which columns are sensible candidates for each axis role. */
export interface ChartColumnRoles {
  /** Categorical/temporal/identifier columns - candidate x-axis / series. */
  labelColumns: string[];
  /** Numeric columns - candidate y-axis (and x for scatter). */
  numericColumns: string[];
}

/**
 * Classify columns into label vs numeric candidates using the semantic profile.
 * A column counts as numeric only if the profile says quantitative; everything
 * else (categorical, temporal, identifier, text) is a label candidate.
 */
export function chartColumnRoles(
  columns: string[],
  rows: Record<string, string>[],
): ChartColumnRoles {
  const profile = profileColumns(columns, rows);
  const numericColumns: string[] = [];
  const labelColumns: string[] = [];
  for (const c of profile.columns) {
    if (c.type === "quantitative") numericColumns.push(c.name);
    else if (c.type !== "empty") labelColumns.push(c.name);
  }
  // Ensure every column lands somewhere (profile may mark all-empty columns).
  for (const name of columns) {
    if (!numericColumns.includes(name) && !labelColumns.includes(name)) {
      labelColumns.push(name);
    }
  }
  return { labelColumns, numericColumns };
}

/**
 * Resolve the axes for a chart: honour the operator's explicit Design choices,
 * else fall back to the first sensible columns from the profile. For scatter,
 * x defaults to the first numeric column (two-quantitative chart); otherwise x
 * defaults to the first label column.
 */
export function resolveChartAxes(
  vizType: string,
  roles: ChartColumnRoles,
  design: { chartX: string; chartY: string; chartSeries: string },
): ChartAxes {
  const { labelColumns, numericColumns } = roles;
  const isScatter = vizType === "scatter";

  const xDefault = isScatter
    ? numericColumns[0] ?? labelColumns[0] ?? ""
    : labelColumns[0] ?? numericColumns[0] ?? "";
  // y defaults to the first numeric column that isn't already x.
  const yDefault =
    numericColumns.find((c) => c !== (design.chartX || xDefault)) ??
    numericColumns[0] ??
    "";

  const x = design.chartX || xDefault;
  const y = design.chartY || yDefault;
  const series = design.chartSeries || "";
  return { x, y, series };
}

/**
 * Build typed chart points from rows for the given axes. Rows whose y value is
 * not a number are dropped. For scatter, x is parsed as a number too; for the
 * other charts x stays a string label.
 */
export function buildChartPoints(
  rows: Record<string, string>[],
  axes: ChartAxes,
  opts: { numericX?: boolean } = {},
): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (const row of rows) {
    const y = parseNumber(row[axes.y]);
    if (y == null) continue;
    let x: string | number;
    if (opts.numericX) {
      const nx = parseNumber(row[axes.x]);
      if (nx == null) continue;
      x = nx;
    } else {
      x = (row[axes.x] ?? "").trim();
      if (x === "") continue;
    }
    const point: ChartPoint = { x, y };
    if (axes.series) {
      const s = (row[axes.series] ?? "").trim();
      if (s !== "") point.series = s;
    }
    out.push(point);
  }
  return out;
}

/**
 * Aggregate points that share the same (x, series) by summing y. Used by
 * bar/line/area so repeated categories collapse into one value. Preserves
 * first-seen order of x and series. Returns points unchanged for scatter.
 */
export function aggregatePoints(points: ChartPoint[]): ChartPoint[] {
  const map = new Map<string, ChartPoint>();
  for (const p of points) {
    const key = `${p.series ?? ""}\u0000${p.x}`;
    const existing = map.get(key);
    if (existing) existing.y += p.y;
    else map.set(key, { ...p });
  }
  return [...map.values()];
}

/**
 * Sort aggregated points by y descending (for bar charts ranked by value).
 * When there are multiple series, sorts within the data as-is (the renderer
 * groups by series), so this is most meaningful for single-series bars.
 */
export function sortPointsByValue(points: ChartPoint[]): ChartPoint[] {
  return [...points].sort((a, b) => b.y - a.y);
}

/** Whether a viz id is a chart handled by this module. */
export const CHART_TYPES = new Set(["bar", "line", "area", "scatter"]);

export function isChartType(vizType: string): boolean {
  return CHART_TYPES.has(vizType);
}
