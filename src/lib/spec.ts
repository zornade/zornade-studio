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
import { colorsForScale } from "../studio/palettes";
import { sanitizeAnnotations, type Annotation } from "./annotations";
import { buildPointFeatures } from "./points";
import { prepareGeoRender } from "./geo-dataset";
import { buildFlows } from "./flow";
import { sanitizeStorySteps, type StoryStep, type StoryCamera } from "./story";
import { DEFAULT_BIVARIATE_PALETTE_ID } from "./bivariate";
import type { GeometryKind } from "../studio/types";
import {
  chartColumnRoles,
  resolveChartAxes,
  buildChartPoints,
  aggregatePoints,
  sortPointsByValue,
  isChartType,
  type ChartPoint,
} from "./chart-data";

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
  /** Numeric value (choropleth/symbol/spike/extrusion; variable A of a bivariate). */
  value?: number;
  /** Second numeric value (variable B of a bivariate map). */
  value2?: number;
  /** Category label (category map). */
  category?: string;
  /** Extra columns referenced by a custom tooltip template (key→text). */
  extra?: Record<string, string>;
}

/**
 * How an area-map spec is painted. All these maps join the same bundled
 * geometry by key; only the rendering differs. Absent ⇒ "choropleth" so specs
 * predating this field keep rendering as choropleths (back-compat).
 */
export type AreaRender =
  | "choropleth"
  | "symbol"
  | "category"
  | "bivariate"
  | "spike"
  | "extrusion"
  | "cartogram";

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
  /** Bivariate: display name + unit for the SECOND variable (B). Optional. */
  valueLabel2?: string;
  valueUnit2?: string;
  /** Bivariate: id of the selected 3×3 colour palette. Absent = default. */
  bivariatePalette?: string;
  titleFont: string;
  showTitle: boolean;
  showLegend: boolean;
  showSource: boolean;
  tooltip: boolean;
  tooltipTemplate: string;
  zoomPan: boolean;
  readerFilters: boolean;
  /** Point colour for symbol/spike maps. */
  pointColor: string;
  /** Base point size for symbol maps. */
  pointSize: number;
  /** Custom raster basemap tile URL (XYZ/WMS), used when basemap = "custom-raster". */
  customBasemapUrl?: string;
  /** Vertical exaggeration of the 3D extrusion. Absent = 1 (no exaggeration). */
  extrusionScale?: number;
}

export interface ChoroplethSpec {
  schemaVersion: typeof SPEC_SCHEMA_VERSION;
  type: "choropleth";
  /** How the area data is painted; absent = "choropleth" (back-compat). */
  render?: AreaRender;
  /** Render on a 3D globe (spherical projection). Absent = false (back-compat). */
  globe?: boolean;
  /** Cartogram variant, present only when render === "cartogram". */
  cartogramKind?: "noncontiguous" | "dorling";
  project: SpecProject;
  geo: {
    level: GeoLevel;
    keyColumn: string;
    valueColumn: string;
    /** Category column for a category map. */
    categoryColumn?: string;
  };
  /** Viewport camera snapshot (center/zoom/pitch/bearing) captured at publish time. */
  camera?: StoryCamera;
  /** Minimal data: one {key, value} per non-empty, numeric row. For a temporal
   * map this is the INITIAL (most recent) frame, so non-temporal viewers still
   * render a valid map. */
  data: SpecDatum[];
  /** Temporal dimension (O3.3): the period column + ordered frame labels. */
  time?: { column: string; frames: string[] };
  /** Per-frame data, present only for a temporal map (one entry per period). */
  frames?: SpecFrame[];
  /** Custom annotations drawn over the map (O3.4); omitted when there are none. */
  annotations?: Annotation[];
  design: SpecDesign;
}

/** How a point-map spec is painted. All share inline coordinates. */
export type PointRender =
  | "points"
  | "locator"
  | "heatmap"
  | "hexbin"
  | "dotdensity";

/** A single published point: coordinates + optional value/category/name. */
export interface SpecPoint {
  lng: number;
  lat: number;
  /** Numeric value (proportional size / heatmap weight). */
  value?: number;
  /** Category label (colour). */
  category?: string;
  /** Label shown in tooltips / locator labels. */
  name?: string;
}

/**
 * Snapshot of a **point** map (O4 publish, phase 2). Unlike the area spec, the
 * geometry IS the payload (coordinates are inline), so the embed never fetches
 * anything. `render` chooses how the points are drawn.
 */
export interface PointSpec {
  schemaVersion: typeof SPEC_SCHEMA_VERSION;
  type: "point";
  render: PointRender;
  project: SpecProject;
  /** Inline points (capped at {@link MAX_PUBLISH_POINTS}). */
  points: SpecPoint[];
  /** Column names for the accessible table + tooltip labels. */
  fields: { name: string; value: string; category: string };
  /** Custom annotations drawn over the map (O3.4); omitted when none. */
  annotations?: Annotation[];
  /** Viewport camera snapshot captured at publish time. */
  camera?: StoryCamera;
  /** Render on a 3D globe (spherical projection). Absent = false (back-compat). */
  globe?: boolean;
  design: SpecDesign;
}

/**
 * Snapshot of a **custom-geometry** map (O4 publish, phase 3). The user's own
 * geometry (Shapefile/KML/GeoJSON) is the payload, inlined and already prepared
 * with `__value`/`__cat`/`__name` on each feature, so the embed draws it
 * directly (no fetch, no join).
 */
export interface GeoSpec {
  schemaVersion: typeof SPEC_SCHEMA_VERSION;
  type: "geo";
  project: SpecProject;
  /** Prepared FeatureCollection (carries `__value`/`__cat`/`__name`). */
  geojson: GeoJSON.FeatureCollection;
  /** Geometry primitives present (drives which layers to add). */
  geometryKinds: GeometryKind[];
  /** Whether features carry a numeric value (graduated colour). */
  hasValue: boolean;
  /** Whether features carry a category (categorical colour). */
  hasCategory: boolean;
  /** Distinct categories (first-seen) for the categorical legend. */
  categories: string[];
  /** Human label for the value (legend/tooltip). */
  valueLabel: string;
  /** Custom annotations drawn over the map (O3.4); omitted when none. */
  annotations?: Annotation[];
  /** Viewport camera snapshot captured at publish time. */
  camera?: StoryCamera;
  /** Render on a 3D globe (spherical projection). Absent = false (back-compat). */
  globe?: boolean;
  design: SpecDesign;
}

/** Any publishable spec: area map, point map, custom geometry, chart, story. */
export type VizSpec = ChoroplethSpec | PointSpec | GeoSpec | ChartSpec | StorySpec;

/** A map spec a story can wrap (charts have no camera, so they're excluded). */
export type StoryBaseSpec = ChoroplethSpec | PointSpec | GeoSpec;

/**
 * Snapshot of a **scrollytelling story** (O4.1). Wraps a base map spec + an
 * ordered list of steps; the embed hosts the base map and flies the camera as
 * each step scrolls into view.
 */
export interface StorySpec {
  schemaVersion: typeof SPEC_SCHEMA_VERSION;
  type: "story";
  project: SpecProject;
  /** The map rendered beneath the story (area/point/geo). */
  base: StoryBaseSpec;
  /** Ordered narrative steps (text + camera). */
  steps: StoryStep[];
  design: SpecDesign;
}

/** Chart render kinds (no geography). */
export type ChartRender = "bar" | "line" | "area" | "scatter" | "table";

/**
 * Snapshot of a **chart** (O4 publish, phase 4). Not a map: the embed renders
 * with Observable Plot (loaded from a pinned CDN). For bar/line/area/scatter
 * the typed points are precomputed; the table ships its columns/rows.
 */
export interface ChartSpec {
  schemaVersion: typeof SPEC_SCHEMA_VERSION;
  type: "chart";
  render: ChartRender;
  project: SpecProject;
  /** Precomputed, aggregated chart points (absent for the table render). */
  points?: ChartPoint[];
  /** Whether the points carry a series (colour split). */
  hasSeries: boolean;
  /** Axis labels (x = category/number; y = value label). */
  axisX: string;
  axisY: string;
  /** Table data (present only for the table render). */
  table?: { columns: string[]; rows: Record<string, string>[] };
  /** Resolved colour scale (already reversed if requested). */
  colors: string[];
  design: SpecDesign;
}

/** Max points carried inline in a published point embed (keeps the file sane). */
export const MAX_PUBLISH_POINTS = 5000;

/** Max features carried inline in a published custom-geometry embed. */
export const MAX_PUBLISH_FEATURES = 5000;

/** Point-map viz types that publish through the point pipeline. */
const POINT_RENDERS = new Set<PointRender>([
  "points",
  "locator",
  "heatmap",
  "hexbin",
  "dotdensity",
]);

/** Area-map viz types that publish through the choropleth (area) pipeline. */
const AREA_RENDERS = new Set<AreaRender>([
  "choropleth",
  "symbol",
  "category",
  "bivariate",
  "spike",
  "extrusion",
  "cartogram",
]);

/** Result of {@link buildSpec}: the spec, or a human reason it can't be built. */
export type BuildSpecResult =
  | { spec: VizSpec }
  | { error: string };

/**
 * Build a deterministic snapshot spec from the current studio state.
 * Supports every **area** map (choropleth, symbol, category, bivariate, spike,
 * 3D extrusion), every **point** map (points, locator, heatmap, hexbin,
 * dot density), and a **custom-geometry** map; other viz types are rejected.
 */
export function buildSpec(state: StudioState & { camera?: StoryCamera | null }): BuildSpecResult {
  // Scrollytelling: when steps exist over a MAP (not a chart), publish a story
  // that wraps the base map. Charts have no camera, so they ignore steps.
  if (
    state.storySteps.length > 0 &&
    !isChartType(state.vizType) &&
    state.vizType !== "table"
  ) {
    return buildStorySpec(state);
  }
  // Charts work on ANY data (they ignore geography), so an explicit chart/table
  // viz takes priority over the dataset kind.
  if (isChartType(state.vizType) || state.vizType === "table") {
    return buildChartSpec(state, state.vizType as ChartRender);
  }
  // Custom geometry (the user's own Shapefile/KML/GeoJSON) publishes by its
  // dataset kind, regardless of the catalog vizType — it IS a map.
  if (state.data?.kind === "geo") {
    return buildGeoSpec(state);
  }
  // Point maps publish through a separate, geometry-inline pipeline.
  if (POINT_RENDERS.has(state.vizType as PointRender)) {
    return buildPointSpec(state, state.vizType as PointRender);
  }
  // Flow maps build arcs from origin/destination columns → a custom-geometry
  // (line) spec; no bundled geometry needed.
  if (state.vizType === "flow") {
    return buildFlowSpec(state);
  }
  const render = state.vizType as AreaRender;
  if (!AREA_RENDERS.has(render)) {
    return { error: `Pubblicazione non ancora supportata per “${state.vizType}”.` };
  }
  const { data, design } = state;
  if (!data) return { error: "Nessun dato caricato." };
  if (data.kind !== "area") {
    return { error: "La pubblicazione è supportata solo per le mappe ad aree." };
  }

  // Reduce to minimal {key, value} data, dropping empty/non-numeric rows.
  // A custom tooltip template may reference extra columns: carry exactly those.
  const extraCols = templateColumns(design.tooltipTemplate).filter((c) =>
    data.columns.includes(c),
  );

  // The category map keys areas by a categorical column, not a numeric value.
  if (render === "category") {
    const categoryColumn = data.categoryColumn;
    if (!categoryColumn) {
      return { error: "Scegli una colonna di categoria nel passo “Struttura”." };
    }
    const datums = reduceCategoryDatums(
      data.rows,
      data.keyColumn,
      categoryColumn,
      extraCols,
    );
    if (datums.length === 0) {
      return { error: "Nessuna categoria da pubblicare." };
    }
    return {
      spec: makeAreaSpec(state, render, datums, { categoryColumn }),
    };
  }

  // The bivariate map carries two numeric values per area.
  if (render === "bivariate") {
    const colA = data.valueColumn;
    const colB =
      design.bivariateColumn2 && data.numericColumns.includes(design.bivariateColumn2)
        ? design.bivariateColumn2
        : data.numericColumns.find((c) => c !== colA) ?? "";
    if (!colB) {
      return { error: "Servono due colonne numeriche per la mappa bivariata." };
    }
    const datums = reduceBivariateDatums(data.rows, data.keyColumn, colA, colB);
    if (datums.length === 0) {
      return { error: "Nessun valore numerico da pubblicare." };
    }
    return { spec: makeAreaSpec(state, render, datums, { bivariateColumn2: colB }) };
  }

  // choropleth / symbol / spike / extrusion: a single numeric value per area.
  const isTemporal =
    render === "choropleth" &&
    !!data.timeColumn &&
    !!data.timeFrames &&
    data.timeFrames.length >= 2;

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

  return { spec: makeAreaSpec(state, render, datums, { time, frames }) };
}

/**
 * Assemble an area-map spec from the reduced data plus optional temporal frames
 * or a category column. Centralises the shared project/geo/design plumbing so
 * every area render kind produces a byte-stable, complete spec.
 */
function makeAreaSpec(
  state: StudioState & { camera?: StoryCamera | null },
  render: AreaRender,
  datums: SpecDatum[],
  opts: {
    time?: { column: string; frames: string[] };
    frames?: SpecFrame[];
    categoryColumn?: string;
    /** Bivariate: the resolved SECOND value column (label fallback). */
    bivariateColumn2?: string;
  } = {},
): ChoroplethSpec {
  const { data, design, project } = state;
  // data is an AreaDataset here (the caller checked data.kind === "area").
  const area = data as Extract<StudioState["data"], { kind: "area" }>;
  return {
    schemaVersion: SPEC_SCHEMA_VERSION,
    type: "choropleth",
    // Keep the field absent for a plain choropleth so existing specs/tests and
    // already-published embeds stay byte-identical.
    ...(render !== "choropleth" ? { render } : {}),
    ...(render === "cartogram" ? { cartogramKind: design.cartogramKind } : {}),
    ...(design.globe ? { globe: true } : {}),
    project: {
      title: project.title,
      subtitle: project.subtitle,
      source: project.source,
    },
    geo: {
      level: area.geoLevel,
      keyColumn: area.keyColumn,
      valueColumn: area.valueColumn,
      ...(opts.categoryColumn ? { categoryColumn: opts.categoryColumn } : {}),
    },
    data: datums,
    ...(opts.time && opts.frames ? { time: opts.time, frames: opts.frames } : {}),
    ...(state.annotations.length > 0
      ? { annotations: sanitizeAnnotations(state.annotations) }
      : {}),
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
      pointColor: design.pointColor,
      pointSize: design.pointSize,
      customBasemapUrl: design.customBasemapUrl ?? "",
      // Bivariate maps carry a second variable (label + unit) and a palette
      // choice; emitted only for that render so other area specs stay
      // byte-identical with previously-published embeds.
      ...(render === "bivariate"
        ? {
            valueLabel2: design.valueLabel2 || opts.bivariateColumn2 || "",
            valueUnit2: design.valueUnit2,
            bivariatePalette:
              design.bivariatePalette || DEFAULT_BIVARIATE_PALETTE_ID,
          }
        : {}),
      // Only for the 3D extrusion, and only when actually exaggerated, so plain
      // choropleth/cartogram specs and unscaled extrusions stay byte-identical.
      ...(render === "extrusion" && (design.extrusionScale ?? 1) !== 1
        ? { extrusionScale: design.extrusionScale }
        : {}),
    },
    ...(state.camera ? { camera: state.camera } : {}),
  };
}

/**
 * Build a point-map spec from a point dataset. The coordinates are carried
 * inline (capped at {@link MAX_PUBLISH_POINTS}); the embed never fetches any
 * geometry. Returns a human error when there are no usable points or too many.
 */
function buildPointSpec(state: StudioState & { camera?: StoryCamera | null }, render: PointRender): BuildSpecResult {
  const { data, design, project } = state;
  if (!data) return { error: "Nessun dato caricato." };
  if (data.kind !== "point") {
    return { error: "Questa mappa richiede dati a punti (con coordinate)." };
  }
  const built = buildPointFeatures({
    rows: data.rows,
    latColumn: data.latColumn,
    lonColumn: data.lonColumn,
    valueColumn: data.valueColumn || undefined,
    categoryColumn: data.categoryColumn,
    nameColumn: data.nameColumn ?? data.categoryColumn,
  });
  const feats = built.geojson.features;
  if (feats.length === 0) {
    return { error: "Nessun punto con coordinate valide da pubblicare." };
  }
  if (feats.length > MAX_PUBLISH_POINTS) {
    return {
      error:
        `Troppi punti da incorporare (${feats.length}; max ${MAX_PUBLISH_POINTS}). ` +
        "Usa una mappa di calore o a esagoni per aggregare, o filtra i dati.",
    };
  }
  const points: SpecPoint[] = feats.map((f) => {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
    const out: SpecPoint = { lng, lat };
    if (typeof p.__value === "number") out.value = p.__value;
    if (typeof p.__cat === "string" && p.__cat !== "") out.category = p.__cat;
    if (typeof p.__name === "string" && p.__name !== "") out.name = p.__name;
    return out;
  });
  const spec: PointSpec = {
    schemaVersion: SPEC_SCHEMA_VERSION,
    type: "point",
    render,
    project: {
      title: project.title,
      subtitle: project.subtitle,
      source: project.source,
    },
    points,
    fields: {
      name: data.nameColumn ?? "",
      value: data.valueColumn ?? "",
      category: data.categoryColumn ?? "",
    },
    ...(state.annotations.length > 0
      ? { annotations: sanitizeAnnotations(state.annotations) }
      : {}),
    ...(design.globe ? { globe: true } : {}),
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
      pointColor: design.pointColor,
      pointSize: design.pointSize,
      customBasemapUrl: design.customBasemapUrl ?? "",
    },
    ...(state.camera ? { camera: state.camera } : {}),
  };
  return { spec };
}

/**
 * Build a scrollytelling story spec (O4.1). Rebuilds the BASE map spec (reusing
 * buildSpec with no steps) and wraps it with the sanitised steps. Charts have no
 * camera, so steps over a chart are rejected here (the caller only routes MAP
 * viz here). Returns a human error when the base can't build or no step is valid.
 */
function buildStorySpec(state: StudioState): BuildSpecResult {
  const base = buildSpec({ ...state, storySteps: [] });
  if ("error" in base) return base;
  if (base.spec.type === "chart" || base.spec.type === "story") {
    return { error: "La storia funziona solo sopra una mappa." };
  }
  const steps = sanitizeStorySteps(state.storySteps);
  if (steps.length === 0) {
    return { error: "Aggiungi almeno un passo con una vista salvata." };
  }
  return {
    spec: {
      schemaVersion: SPEC_SCHEMA_VERSION,
      type: "story",
      project: {
        title: state.project.title,
        subtitle: state.project.subtitle,
        source: state.project.source,
      },
      base: base.spec,
      steps,
      design: chartDesign(state.design),
    },
  };
}

/**
 * Build a flow-map spec: arcs between origin/destination coordinate columns,
 * emitted as a custom-geometry (line) spec. No bundled geometry needed — the
 * arcs are computed from the data rows. Capped at {@link MAX_PUBLISH_FEATURES}.
 */
function buildFlowSpec(state: StudioState): BuildSpecResult {
  const { data, design, project } = state;
  if (!data) return { error: "Nessun dato caricato." };
  const { flowFromLat, flowFromLon, flowToLat, flowToLon, flowValue } = design;
  if (!flowFromLat || !flowFromLon || !flowToLat || !flowToLon) {
    return {
      error: "Scegli le colonne di origine e destinazione nel passo “Design”.",
    };
  }
  const built = buildFlows(data.rows, {
    fromLat: flowFromLat,
    fromLon: flowFromLon,
    toLat: flowToLat,
    toLon: flowToLon,
    value: flowValue || undefined,
  });
  const feats = built.geojson.features;
  if (feats.length === 0) {
    return { error: "Nessun flusso con coordinate valide da pubblicare." };
  }
  if (feats.length > MAX_PUBLISH_FEATURES) {
    return {
      error: `Troppi flussi da incorporare (${feats.length}; max ${MAX_PUBLISH_FEATURES}).`,
    };
  }
  const spec: GeoSpec = {
    schemaVersion: SPEC_SCHEMA_VERSION,
    type: "geo",
    project: { title: project.title, subtitle: project.subtitle, source: project.source },
    geojson: built.geojson,
    geometryKinds: ["line"],
    hasValue: !!flowValue && !!built.valueRange,
    hasCategory: false,
    categories: [],
    valueLabel: design.valueLabel || flowValue || "Flusso",
    ...(state.annotations.length > 0
      ? { annotations: sanitizeAnnotations(state.annotations) }
      : {}),
    design: chartDesign(design),
  };
  return { spec };
}

/**
 * Build a custom-geometry spec from a geo dataset. The user's geometry is
 * prepared (via {@link prepareGeoRender}) with `__value`/`__cat`/`__name` and
 * inlined; capped at {@link MAX_PUBLISH_FEATURES}. Returns a human error when
 * empty or too large.
 */
function buildGeoSpec(state: StudioState & { camera?: StoryCamera | null }): BuildSpecResult {
  const { data, design, project } = state;
  if (!data || data.kind !== "geo") {
    return { error: "Questa pubblicazione richiede una geometria caricata." };
  }
  if (data.geojson.features.length === 0) {
    return { error: "La geometria non contiene elementi da pubblicare." };
  }
  if (data.geojson.features.length > MAX_PUBLISH_FEATURES) {
    return {
      error:
        `Troppi elementi da incorporare (${data.geojson.features.length}; ` +
        `max ${MAX_PUBLISH_FEATURES}). Semplifica o filtra la geometria.`,
    };
  }
  const prepared = prepareGeoRender(data);
  const hasValue = !!data.valueColumn && prepared.values.length > 0;
  const hasCategory = !!data.categoryColumn && prepared.categories.length > 0;
  const spec: GeoSpec = {
    schemaVersion: SPEC_SCHEMA_VERSION,
    type: "geo",
    project: {
      title: project.title,
      subtitle: project.subtitle,
      source: project.source,
    },
    geojson: prepared.geojson,
    geometryKinds: [...data.geometryKinds],
    hasValue,
    hasCategory,
    categories: prepared.categories,
    valueLabel: design.valueLabel || data.valueColumn || "Valore",
    ...(state.annotations.length > 0
      ? { annotations: sanitizeAnnotations(state.annotations) }
      : {}),
    ...(design.globe ? { globe: true } : {}),
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
      pointColor: design.pointColor,
      pointSize: design.pointSize,
      customBasemapUrl: design.customBasemapUrl ?? "",
    },
    ...(state.camera ? { camera: state.camera } : {}),
  };
  return { spec };
}

/**
 * Build a chart spec (O4 publish, phase 4). Charts ignore geography: the typed,
 * aggregated points are precomputed with the same pure pipeline the editor uses
 * (`chart-data`), so the embed only has to draw them with Observable Plot. The
 * table render ships its columns/rows (capped at {@link MAX_PUBLISH_POINTS}).
 */
function buildChartSpec(state: StudioState, render: ChartRender): BuildSpecResult {
  const { data, design, project } = state;
  if (!data) return { error: "Nessun dato caricato." };
  const colors = colorsForScale(design.colorScale, design.reverseScale);

  if (render === "table") {
    if (data.rows.length > MAX_PUBLISH_POINTS) {
      return {
        error:
          `Troppe righe da incorporare (${data.rows.length}; max ${MAX_PUBLISH_POINTS}). ` +
          "Filtra o riassumi i dati.",
      };
    }
    return {
      spec: {
        schemaVersion: SPEC_SCHEMA_VERSION,
        type: "chart",
        render,
        project: { title: project.title, subtitle: project.subtitle, source: project.source },
        hasSeries: false,
        axisX: "",
        axisY: "",
        table: { columns: [...data.columns], rows: data.rows.map((r) => ({ ...r })) },
        colors,
        design: chartDesign(design),
      },
    };
  }

  // bar / line / area / scatter — mirror ChartCanvas's preparation exactly.
  const roles = chartColumnRoles(data.columns, data.rows);
  const axes = resolveChartAxes(render, roles, design);
  if (!axes.x || !axes.y) {
    return { error: "Scegli le colonne per gli assi nel passo “Struttura”." };
  }
  const isScatter = render === "scatter";
  let points = buildChartPoints(data.rows, axes, { numericX: isScatter });
  if (!isScatter) {
    points = aggregatePoints(points);
    if (design.chartSortByValue && !axes.series) points = sortPointsByValue(points);
  }
  if (points.length === 0) {
    return { error: "Nessun dato numerico da rappresentare nel grafico." };
  }
  const hasSeries = points.some((p) => p.series != null);
  const unit = design.valueUnit;
  const yLabel = design.valueLabel || axes.y;
  return {
    spec: {
      schemaVersion: SPEC_SCHEMA_VERSION,
      type: "chart",
      render,
      project: { title: project.title, subtitle: project.subtitle, source: project.source },
      points,
      hasSeries,
      axisX: axes.x,
      axisY: unit ? `${yLabel} (${unit})` : yLabel,
      colors,
      design: chartDesign(design),
    },
  };
}

/** Minimal SpecDesign for a chart (only the fields the embed reads). */
function chartDesign(design: StudioState["design"]): SpecDesign {
  return {
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
    pointColor: design.pointColor,
    pointSize: design.pointSize,
  };
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

/**
 * Reduce rows to {key, category} data for a category map: drop empty keys/
 * categories, de-duplicate keys (last wins). Carries the optional extra columns
 * for a custom tooltip, mirroring {@link reduceDatums}.
 */
function reduceCategoryDatums(
  rows: Record<string, string>[],
  keyColumn: string,
  categoryColumn: string,
  extraCols: string[],
): SpecDatum[] {
  const seen = new Set<string>();
  const datums: SpecDatum[] = [];
  for (const row of rows) {
    const rawKey = row[keyColumn];
    const key = rawKey == null ? "" : String(rawKey).trim();
    const category = (row[categoryColumn] ?? "").trim();
    if (key === "" || category === "") continue;
    const extra =
      extraCols.length > 0
        ? Object.fromEntries(extraCols.map((c) => [c, String(row[c] ?? "")]))
        : undefined;
    if (seen.has(key)) {
      const idx = datums.findIndex((dd) => dd.key === key);
      if (idx !== -1) {
        datums[idx].category = category;
        if (extra) datums[idx].extra = extra;
      }
      continue;
    }
    seen.add(key);
    datums.push(extra ? { key, category, extra } : { key, category });
  }
  return datums;
}

/**
 * Reduce rows to {key, value, value2} data for a bivariate map: both values
 * must parse as numbers. De-duplicates keys (last wins).
 */
function reduceBivariateDatums(
  rows: Record<string, string>[],
  keyColumn: string,
  columnA: string,
  columnB: string,
): SpecDatum[] {
  const seen = new Set<string>();
  const datums: SpecDatum[] = [];
  for (const row of rows) {
    const rawKey = row[keyColumn];
    const key = rawKey == null ? "" : String(rawKey).trim();
    const value = parseNumber(row[columnA]);
    const value2 = parseNumber(row[columnB]);
    if (key === "" || value == null || value2 == null) continue;
    if (seen.has(key)) {
      const idx = datums.findIndex((dd) => dd.key === key);
      if (idx !== -1) {
        datums[idx].value = value;
        datums[idx].value2 = value2;
      }
      continue;
    }
    seen.add(key);
    datums.push({ key, value, value2 });
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

/** Type guard for a point-map spec (coordinates inline). */
export function isPointSpec(value: unknown): value is PointSpec {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === SPEC_SCHEMA_VERSION &&
    v.type === "point" &&
    typeof v.project === "object" &&
    Array.isArray(v.points) &&
    typeof v.design === "object"
  );
}

/** Type guard for a custom-geometry spec (geometry inline). */
export function isGeoSpec(value: unknown): value is GeoSpec {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === SPEC_SCHEMA_VERSION &&
    v.type === "geo" &&
    typeof v.project === "object" &&
    typeof v.geojson === "object" &&
    typeof v.design === "object"
  );
}

/** Type guard for a chart spec (Observable Plot, no geography). */
export function isChartSpec(value: unknown): value is ChartSpec {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === SPEC_SCHEMA_VERSION &&
    v.type === "chart" &&
    typeof v.project === "object" &&
    typeof v.render === "string" &&
    typeof v.design === "object"
  );
}

/** Type guard for a scrollytelling story spec (O4.1). */
export function isStorySpec(value: unknown): value is StorySpec {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === SPEC_SCHEMA_VERSION &&
    v.type === "story" &&
    typeof v.project === "object" &&
    typeof v.base === "object" &&
    Array.isArray(v.steps) &&
    typeof v.design === "object"
  );
}

/** Type guard for any publishable spec (area, point, geometry, or chart). */
export function isVizSpec(value: unknown): value is VizSpec {
  return (
    isChoroplethSpec(value) ||
    isPointSpec(value) ||
    isGeoSpec(value) ||
    isChartSpec(value) ||
    isStorySpec(value)
  );
}
