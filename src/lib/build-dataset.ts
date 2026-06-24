/**
 * Dataset ingestion core: turn a parsed table (or CSV text) into a ready
 * {@link DatasetState}, or a human-readable error message.
 *
 * Format-specific parsers (CSV, Excel, GeoJSON) all funnel through
 * {@link buildDatasetFromTable} so geo-resolution, key/value detection and
 * error messages stay identical across formats. The logic is deterministic
 * given the geo-key index: the only side effect is loading that index
 * ({@link loadGeoKeys}); when it is unavailable the resolver falls back to
 * name-based detection. Extracted verbatim from DataPanel to keep the decision
 * logic unit-testable in isolation.
 */
import { parseCsv, detectNumericColumns } from "./csv";
import {
  GEO_LEVELS,
  detectGeoLevel,
  detectKeyColumn,
  resolveGeoJoin,
  type GeoLevel,
} from "./choropleth";
import { loadGeoKeys } from "./geo-keys";
import { profileColumns } from "./profile";
import { detectWide, meltWide } from "./reshape";
import { detectTimeColumn, framesOf } from "./temporal";
import type { DatasetState } from "../studio/types";

/** Result of an ingestion attempt: a ready dataset or a user-facing error. */
export type BuildDatasetResult = { dataset: DatasetState } | { error: string };

/**
 * Parse CSV text into a ready DatasetState, or return a human error message.
 * Shared by file upload and the live catalogue loader.
 *
 * Geo level + key column are resolved by matching actual values against the
 * real geometry keys ({@link resolveGeoJoin}); name-based detection is only a
 * fallback when the keys index is unavailable.
 */
export async function buildDatasetFromCsv(
  text: string,
  fileName: string,
): Promise<BuildDatasetResult> {
  return buildDatasetFromTable(parseCsv(text), fileName);
}

/**
 * Turn an already-parsed table ({ columns, rows }) into a ready DatasetState,
 * or a human error message. Format-specific parsers (CSV, Excel, GeoJSON) all
 * funnel through here so geo-resolution, key/value detection and error
 * messages stay identical across formats.
 */
export async function buildDatasetFromTable(
  table: { columns: string[]; rows: Record<string, string>[] },
  fileName: string,
): Promise<BuildDatasetResult> {
  const { columns, rows } = table;
  if (columns.length === 0 || rows.length === 0) {
    return { error: "Il file sembra vuoto o non leggibile." };
  }

  // 1) POINT path has priority: explicit lat/lon columns are unambiguous
  // geometry the user supplied on purpose. Detection requires the column to be
  // *named* lat/lon (+ in range), so real choropleth files — which have no such
  // columns — are never stolen by this branch.
  const profile = profileColumns(columns, rows);
  const latCol = profile.columns.find((c) => c.type === "geo-point-lat")?.name;
  const lonCol = profile.columns.find((c) => c.type === "geo-point-lon")?.name;
  if (latCol && lonCol) {
    const numericColumns = detectNumericColumns(columns, rows).filter(
      (c) => c !== latCol && c !== lonCol,
    );
    const categoryColumn = profile.columns.find(
      (c) => c.type === "categorical",
    )?.name;
    // Label column for tooltips: the first identifier/text column (a place
    // name like "città"), falling back to the category.
    const nameColumn =
      profile.columns.find(
        (c) =>
          (c.type === "identifier" || c.type === "text") &&
          c.name !== latCol &&
          c.name !== lonCol,
      )?.name ?? categoryColumn;
    return {
      dataset: {
        kind: "point",
        fileName,
        columns,
        rows,
        latColumn: latCol,
        lonColumn: lonCol,
        valueColumn: numericColumns[0] ?? "",
        categoryColumn,
        nameColumn,
        numericColumns,
      },
    };
  }

  // 2) AREA (choropleth) path: match values against geometry keys.
  // First, melt a WIDE table (one column per period, e.g. comune,2015,2016) to
  // long form so it becomes a temporal choropleth (one frame per period) rather
  // than N separate value columns. Only the area attempt uses the melted form;
  // points (handled above) and the table fallback keep the original shape.
  const wide = detectWide(columns);
  const aColumns = wide
    ? meltWide({ columns, rows }, wide, { periodName: "periodo", valueName: "valore" }).columns
    : columns;
  const aRows = wide
    ? meltWide({ columns, rows }, wide, { periodName: "periodo", valueName: "valore" }).rows
    : rows;

  const keys = await loadGeoKeys();
  const resolved =
    Object.keys(keys).length > 0 ? resolveGeoJoin(aColumns, aRows, keys) : null;
  let areaLevel: GeoLevel | null = null;
  let areaKey: string | null = null;
  if (resolved) {
    areaLevel = resolved.level;
    areaKey = resolved.keyColumn;
  } else {
    const detected = detectGeoLevel(aColumns);
    if (detected && GEO_LEVELS[detected].ready) {
      areaLevel = detected;
      areaKey = detectKeyColumn(detected, aColumns);
    }
  }

  if (areaLevel && areaKey) {
    // Temporal: the melted "periodo" column, or a detected period column in an
    // already-long table (e.g. comune,anno,valore). The period column is never
    // a measure, so it is excluded from the value candidates.
    const timeColumn = wide
      ? "periodo"
      : detectTimeColumn(aColumns, aRows, [areaKey]);
    const numericColumns = detectNumericColumns(aColumns, aRows).filter(
      (c) => c !== areaKey && c !== timeColumn,
    );
    if (numericColumns.length === 0) {
      return { error: "Nessuna colonna numerica da mappare trovata." };
    }
    const timeFrames = timeColumn ? framesOf(aRows, timeColumn) : undefined;
    // A sensible default category column for the category map: the first
    // categorical column that isn't the geo key (may be undefined).
    const categoryColumn = profileColumns(aColumns, aRows).columns.find(
      (c) => c.type === "categorical" && c.name !== areaKey && c.name !== timeColumn,
    )?.name;
    return {
      dataset: {
        kind: "area",
        fileName,
        columns: aColumns,
        rows: aRows,
        geoLevel: areaLevel,
        keyColumn: areaKey,
        valueColumn: numericColumns[0],
        categoryColumn,
        numericColumns,
        ...(timeColumn && timeFrames && timeFrames.length >= 2
          ? { timeColumn, timeFrames }
          : {}),
      },
    };
  }

  // No geography (no area key, no lat/lon): fall back to a plain table dataset.
  // It can't go on a map, but it feeds the chart pipeline (bar/line/area/
  // scatter) and the rich table. Need at least one numeric column to be useful.
  const numericColumns = detectNumericColumns(columns, rows);
  if (numericColumns.length === 0) {
    return {
      error:
        "Nessuna colonna numerica trovata: serve almeno una colonna di numeri " +
        "per fare un grafico, oppure una colonna geografica per una mappa.",
    };
  }
  const labelColumns = profile.columns
    .filter((c) => c.type !== "quantitative" && c.type !== "empty")
    .map((c) => c.name);
  return {
    dataset: {
      kind: "table",
      fileName,
      columns,
      rows,
      numericColumns,
      labelColumns,
    },
  };
}
