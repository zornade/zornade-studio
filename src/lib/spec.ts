/**
 * Snapshot specification — the "spec-driven" serialisation of a published map
 * (STRATEGIA §6.2). A spec is a **self-contained, versioned JSON** that holds
 * everything needed to re-render a map independently of the live editor state:
 * project texts, geo level, the minimal joined data, and the design.
 *
 * It is the foundation for three things:
 *  - the immutable published embed/snapshot (O1.5),
 *  - the static SVG/PNG fallback,
 *  - saving/loading projects (O2.9).
 *
 * Design goals: **deterministic** (same input → same JSON, so snapshots are
 * stable and testable) and **minimal** (only the key + value columns are kept,
 * not the whole uploaded table).
 */

import type { StudioState } from "../studio/types";
import type { GeoLevel } from "./choropleth";
import { parseNumber } from "./csv";
import { templateColumns } from "./tooltip";
import { rowsForFrame } from "./temporal";

/** Bump when the shape changes incompatibly; older embeds keep their version. */
export const SPEC_SCHEMA_VERSION = 1 as const;

export interface SpecProject {
  title: string;
  subtitle: string;
  source: string;
}

/** A single area row reduced to its join key and numeric value. */
export interface SpecDatum {
  key: string;
  value: number;
  /** Extra columns referenced by a custom tooltip template (key→text). */
  extra?: Record<string, string>;
}

/** One time frame of a temporal choropleth: a period label + its data (O3.3). */
export interface SpecFrame {
  period: string;
  data: SpecDatum[];
}

export interface SpecDesign {
  basemap: string;
  colorScale: string;
  reverseScale: boolean;
  classification: string;
  manualBreaks: number[];
  legendType: string;
  nClasses: number;
  valueLabel: string;
  valueUnit: string;
  titleFont: string;
  showTitle: boolean;
  showLegend: boolean;
  showSource: boolean;
  tooltip: boolean;
  tooltipTemplate: string;
  zoomPan: boolean;
  readerFilters: boolean;
}

export interface ChoroplethSpec {
  schemaVersion: typeof SPEC_SCHEMA_VERSION;
  type: "choropleth";
  project: SpecProject;
  geo: { level: GeoLevel; keyColumn: string; valueColumn: string };
  /** Minimal data: one {key, value} per non-empty, numeric row. For a temporal
   * map this is the INITIAL (most recent) frame, so non-temporal viewers still
   * render a valid map. */
  data: SpecDatum[];
  /** Temporal dimension (O3.3): the period column + ordered frame labels. */
  time?: { column: string; frames: string[] };
  /** Per-frame data, present only for a temporal map (one entry per period). */
  frames?: SpecFrame[];
  design: SpecDesign;
}

export type VizSpec = ChoroplethSpec;

/** Result of {@link buildSpec}: the spec, or a human reason it can't be built. */
export type BuildSpecResult =
  | { spec: VizSpec }
  | { error: string };

/**
 * Build a deterministic snapshot spec from the current studio state.
 * Only the choropleth is implemented today; other viz types are rejected with
 * a clear reason rather than producing a broken spec.
 */
export function buildSpec(state: StudioState): BuildSpecResult {
  if (state.vizType !== "choropleth") {
    return { error: `Pubblicazione non ancora supportata per “${state.vizType}”.` };
  }
  const { data, design, project } = state;
  if (!data) return { error: "Nessun dato caricato." };
  if (data.kind !== "area") {
    return { error: "La pubblicazione è supportata solo per le mappe ad aree." };
  }

  // Reduce to minimal {key, value} data, dropping empty/non-numeric rows.
  // A custom tooltip template may reference extra columns: carry exactly those.
  const extraCols = templateColumns(design.tooltipTemplate).filter((c) =>
    data.columns.includes(c),
  );

  const isTemporal =
    !!data.timeColumn && !!data.timeFrames && data.timeFrames.length >= 2;

  let datums: SpecDatum[];
  let time: { column: string; frames: string[] } | undefined;
  let frames: SpecFrame[] | undefined;
  if (isTemporal) {
    const col = data.timeColumn!;
    frames = data.timeFrames!.map((period) => ({
      period,
      data: reduceDatums(
        rowsForFrame(data.rows, col, period),
        data.keyColumn,
        data.valueColumn,
        extraCols,
      ),
    }));
    if (!frames.some((f) => f.data.length > 0)) {
      return { error: "Nessun valore numerico da pubblicare." };
    }
    time = { column: col, frames: data.timeFrames! };
    // Initial display = the most recent frame (matches the editor default).
    datums = frames[frames.length - 1].data;
  } else {
    datums = reduceDatums(data.rows, data.keyColumn, data.valueColumn, extraCols);
    if (datums.length === 0) {
      return { error: "Nessun valore numerico da pubblicare." };
    }
  }

  const spec: ChoroplethSpec = {
    schemaVersion: SPEC_SCHEMA_VERSION,
    type: "choropleth",
    project: {
      title: project.title,
      subtitle: project.subtitle,
      source: project.source,
    },
    geo: {
      level: data.geoLevel,
      keyColumn: data.keyColumn,
      valueColumn: data.valueColumn,
    },
    data: datums,
    ...(time && frames ? { time, frames } : {}),
    design: {
      basemap: design.basemap,
      colorScale: design.colorScale,
      reverseScale: design.reverseScale,
      classification: design.classification,
      manualBreaks: [...design.manualBreaks],
      legendType: design.legendType,
      nClasses: design.nClasses,
      valueLabel: design.valueLabel,
      valueUnit: design.valueUnit,
      titleFont: design.titleFont,
      showTitle: design.showTitle,
      showLegend: design.showLegend,
      showSource: design.showSource,
      tooltip: design.tooltip,
      tooltipTemplate: design.tooltipTemplate,
      zoomPan: design.zoomPan,
      readerFilters: design.readerFilters,
    },
  };
  return { spec };
}

/**
 * Reduce rows to minimal {key, value(+extra)} data, dropping empty/non-numeric
 * rows and de-duplicating keys (last value wins, matching the join's Map
 * semantics). Shared by the single-frame and per-frame (temporal) paths.
 */
function reduceDatums(
  rows: Record<string, string>[],
  keyColumn: string,
  valueColumn: string,
  extraCols: string[],
): SpecDatum[] {
  const seen = new Set<string>();
  const datums: SpecDatum[] = [];
  for (const row of rows) {
    const rawKey = row[keyColumn];
    const key = rawKey == null ? "" : String(rawKey).trim();
    const value = parseNumber(row[valueColumn]);
    if (key === "" || value == null) continue;
    const extra =
      extraCols.length > 0
        ? Object.fromEntries(extraCols.map((c) => [c, String(row[c] ?? "")]))
        : undefined;
    if (seen.has(key)) {
      const idx = datums.findIndex((dd) => dd.key === key);
      if (idx !== -1) {
        datums[idx].value = value;
        if (extra) datums[idx].extra = extra;
      }
      continue;
    }
    seen.add(key);
    datums.push(extra ? { key, value, extra } : { key, value });
  }
  return datums;
}

/** Serialise a spec to a stable JSON string (recursively sorted keys →
 * byte-stable across runs, without dropping any nested data). */
export function serialiseSpec(spec: VizSpec): string {
  return JSON.stringify(sortDeep(spec));
}

/** Recursively return a copy with object keys sorted; arrays keep their order. */
function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Type guard / validator for a parsed spec (e.g. when loading a saved file). */
export function isChoroplethSpec(value: unknown): value is ChoroplethSpec {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === SPEC_SCHEMA_VERSION &&
    v.type === "choropleth" &&
    typeof v.project === "object" &&
    typeof v.geo === "object" &&
    Array.isArray(v.data) &&
    typeof v.design === "object"
  );
}
