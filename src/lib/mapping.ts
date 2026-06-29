/**
 * Dataset mapping (ROADMAP - "Struttura" step). Pure, dependency-light, tested.
 *
 * A loaded file is auto-detected into a {@link DatasetState} (area/point/geo/
 * table) with column bindings (geo key + level, lat/lon, value, category, time,
 * label). The **Struttura** step lets the operator review and OVERRIDE those
 * choices before picking a visualisation. This module is the single source of
 * truth for that mapping:
 *
 *  - {@link mappingFromDataset} reads the current bindings into an editable
 *    {@link DatasetMapping};
 *  - {@link applyMapping} rebuilds a {@link DatasetState} from an (edited)
 *    mapping - the inverse - trusting the operator's choices (no re-detection,
 *    so no geo-keys/network needed here);
 *  - {@link kindsAvailable} says which dataset shapes the columns can support,
 *    so the UI only offers viable options;
 *  - {@link roleOf} derives a per-column role badge for the table preview.
 *
 * Uploaded **geometry** ("geo") is special: its geometry cannot be synthesised
 * from a table, so its kind is locked and only value/category/label are edited.
 */

import type { GeoLevel } from "./choropleth";
import type {
  DatasetState,
  GeoDataset,
} from "../studio/types";
import { detectNumericColumns } from "./csv";
import { framesOf } from "./temporal";
import { profileColumns } from "./profile";

export type DatasetKind = "area" | "point" | "geo" | "table";

/** Editable column bindings for the Struttura step. `null` = unset. */
export interface DatasetMapping {
  kind: DatasetKind;
  /** Geo level for the area join (when kind === "area"). */
  geoLevel: GeoLevel | null;
  /** Column used as the geographic join key (area). */
  keyColumn: string | null;
  /** Latitude / longitude columns (point). */
  latColumn: string | null;
  lonColumn: string | null;
  /** Primary numeric column (choropleth colour / bubble size). */
  valueColumn: string | null;
  /** Categorical column (category map / point colour). */
  categoryColumn: string | null;
  /** Period column enabling the time slider (area, long form). */
  timeColumn: string | null;
  /** Label column shown in tooltips (point/geo). */
  nameColumn: string | null;
}

/** Per-column role, for the table-preview badges. */
export type ColumnRole =
  | "geo-key"
  | "lat"
  | "lon"
  | "time"
  | "category"
  | "value"
  | "label"
  | "numeric"
  | "other";

export type ApplyMappingResult = { dataset: DatasetState } | { error: string };

/** Read the current dataset's bindings into an editable mapping. */
export function mappingFromDataset(d: DatasetState): DatasetMapping {
  const base: DatasetMapping = {
    kind: d.kind,
    geoLevel: null,
    keyColumn: null,
    latColumn: null,
    lonColumn: null,
    valueColumn: null,
    categoryColumn: null,
    timeColumn: null,
    nameColumn: null,
  };
  switch (d.kind) {
    case "area":
      return {
        ...base,
        geoLevel: d.geoLevel,
        keyColumn: d.keyColumn,
        valueColumn: d.valueColumn || null,
        categoryColumn: d.categoryColumn ?? null,
        timeColumn: d.timeColumn ?? null,
      };
    case "point":
      return {
        ...base,
        latColumn: d.latColumn,
        lonColumn: d.lonColumn,
        valueColumn: d.valueColumn || null,
        categoryColumn: d.categoryColumn ?? null,
        nameColumn: d.nameColumn ?? null,
      };
    case "geo":
      return {
        ...base,
        valueColumn: d.valueColumn || null,
        categoryColumn: d.categoryColumn ?? null,
        nameColumn: d.nameColumn ?? null,
      };
    case "table":
      return base;
  }
}

/**
 * Rebuild a DatasetState from an edited mapping, trusting the operator's choices
 * (no geometry/keys re-resolution). Returns a human error when a required
 * binding for the chosen kind is missing. The columns/rows/fileName come from
 * the previous dataset (the parsed, possibly melted, table is stable).
 */
export function applyMapping(
  prev: DatasetState,
  mapping: DatasetMapping,
): ApplyMappingResult {
  const { columns, rows, fileName } = prev;
  const numericAll = detectNumericColumns(columns, rows);

  if (mapping.kind === "geo") {
    if (prev.kind !== "geo") {
      return {
        error:
          "Solo un file con geometria propria può essere una mappa a geometria.",
      };
    }
    const geo = prev as GeoDataset;
    return {
      dataset: {
        ...geo,
        valueColumn: mapping.valueColumn ?? "",
        categoryColumn: mapping.categoryColumn ?? undefined,
        nameColumn: mapping.nameColumn ?? undefined,
      },
    };
  }

  if (mapping.kind === "area") {
    if (!mapping.keyColumn) {
      return { error: "Scegli la colonna chiave geografica." };
    }
    if (!mapping.geoLevel) {
      return { error: "Scegli il livello geografico (regioni, province…)." };
    }
    const time = mapping.timeColumn || undefined;
    const numericColumns = numericAll.filter(
      (c) => c !== mapping.keyColumn && c !== time,
    );
    if (numericColumns.length === 0) {
      return { error: "Serve almeno una colonna numerica da mappare." };
    }
    const valueColumn =
      mapping.valueColumn && numericColumns.includes(mapping.valueColumn)
        ? mapping.valueColumn
        : numericColumns[0];
    const timeFrames = time ? framesOf(rows, time) : undefined;
    const useTime = !!time && !!timeFrames && timeFrames.length >= 2;
    return {
      dataset: {
        kind: "area",
        fileName,
        columns,
        rows,
        numericColumns,
        geoLevel: mapping.geoLevel,
        keyColumn: mapping.keyColumn,
        valueColumn,
        categoryColumn: mapping.categoryColumn || undefined,
        ...(useTime ? { timeColumn: time, timeFrames } : {}),
      },
    };
  }

  if (mapping.kind === "point") {
    if (!mapping.latColumn || !mapping.lonColumn) {
      return { error: "Scegli le colonne di latitudine e longitudine." };
    }
    if (mapping.latColumn === mapping.lonColumn) {
      return { error: "Latitudine e longitudine devono essere colonne diverse." };
    }
    const numericColumns = numericAll.filter(
      (c) => c !== mapping.latColumn && c !== mapping.lonColumn,
    );
    const valueColumn =
      mapping.valueColumn && numericColumns.includes(mapping.valueColumn)
        ? mapping.valueColumn
        : "";
    return {
      dataset: {
        kind: "point",
        fileName,
        columns,
        rows,
        numericColumns,
        latColumn: mapping.latColumn,
        lonColumn: mapping.lonColumn,
        valueColumn,
        categoryColumn: mapping.categoryColumn || undefined,
        nameColumn: mapping.nameColumn || undefined,
      },
    };
  }

  // table
  const numericColumns = numericAll;
  const profile = profileColumns(columns, rows);
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

/**
 * Which dataset shapes the columns can support, so the UI offers only viable
 * options. An uploaded geometry is locked to "geo". For tabular data: "table"
 * is always possible; "area" needs a candidate key (a non-numeric column) plus
 * a numeric column; "point" needs at least two numeric columns (any two can be
 * designated lat/lon).
 */
export function kindsAvailable(prev: DatasetState): Set<DatasetKind> {
  if (prev.kind === "geo") return new Set<DatasetKind>(["geo"]);
  const numeric = new Set(detectNumericColumns(prev.columns, prev.rows));
  const hasNumeric = numeric.size >= 1;
  const hasLabel = prev.columns.some((c) => !numeric.has(c));
  const out = new Set<DatasetKind>(["table"]);
  if (hasLabel && hasNumeric) out.add("area");
  if (numeric.size >= 2) out.add("point");
  return out;
}

/** Derive a column's role for the preview badges, from the active mapping. */
export function roleOf(
  column: string,
  mapping: DatasetMapping,
  numericColumns: Iterable<string>,
): ColumnRole {
  if (column === mapping.keyColumn) return "geo-key";
  if (column === mapping.latColumn) return "lat";
  if (column === mapping.lonColumn) return "lon";
  if (column === mapping.timeColumn) return "time";
  if (column === mapping.categoryColumn) return "category";
  if (column === mapping.valueColumn) return "value";
  if (column === mapping.nameColumn) return "label";
  const numeric = numericColumns instanceof Set ? numericColumns : new Set(numericColumns);
  return numeric.has(column) ? "numeric" : "other";
}

/** Italian label for a dataset kind (UI). */
export function kindLabel(kind: DatasetKind): string {
  switch (kind) {
    case "area":
      return "Mappa per aree";
    case "point":
      return "Mappa per punti";
    case "geo":
      return "Geometria propria";
    case "table":
      return "Tabella / grafico";
  }
}
