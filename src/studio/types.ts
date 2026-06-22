import type { NewsroomBrand } from "../basemap";
import type { PresetChoice } from "./catalog";
import type { GeoLevel } from "../lib/choropleth";

export type StepId = "data" | "visualize" | "design" | "publish";

export type DataSourceKind =
  | "upload"
  | "paste"
  | "url"
  | "api"
  | "osm"
  | "zornade-db"
  | null;

export interface ProjectMeta {
  title: string;
  subtitle: string;
  source: string;
}

export interface DesignSettings {
  /** CSS font-family applied to the title/subtitle overlay. */
  titleFont: string;
  /** id of the basemap (see MAP_BASEMAPS); "none" = transparent background. */
  basemap: string;
  /** id of the data color scale (see COLOR_SCALES). */
  colorScale: string;
  /** Reverse the colour scale (e.g. dark→light instead of light→dark). */
  reverseScale: boolean;
  /** id of the classification method (see CLASSIFICATION_METHODS). */
  classification: string;
  /** Manual class thresholds, used when classification === "manual". */
  manualBreaks: number[];
  /** id of the legend type (see LEGEND_TYPES). */
  legendType: string;
  /** Number of classes for the choropleth (capped at distinct values). */
  nClasses: number;
  /** Display name for the mapped value (legend + tooltip). Empty = column name. */
  valueLabel: string;
  /** Optional unit of measure appended to values (e.g. "%", "€/m²", "ha"). */
  valueUnit: string;
  /** Point layer: colour of points without a category (and category fallback). */
  pointColor: string;
  /** Point layer: base radius in px (also the centre of the size scale). */
  pointSize: number;
  showTitle: boolean;
  showLegend: boolean;
  showSource: boolean;
  /** Show a tooltip with name + value on hover. */
  tooltip: boolean;
  /** Custom tooltip HTML template ({nome}, {valore}, {colonna}); "" = default. */
  tooltipTemplate: string;
  /** Allow the reader to zoom and pan the published map. */
  zoomPan: boolean;
  /** Clickable legend: the reader can show/hide value classes. */
  readerFilters: boolean;
  /** Chart: column for the x-axis (category/time). "" = first label column. */
  chartX: string;
  /** Chart: column(s) for the y-axis (numeric). "" = first numeric column. */
  chartY: string;
  /** Chart: optional column to split into series/colour. "" = none. */
  chartSeries: string;
  /** Chart: sort bars/categories by value descending. */
  chartSortByValue: boolean;
}

/**
 * A parsed tabular dataset bound to a geographic level for choropleth mapping.
 * Geometry is loaded lazily by the map from the level definition; this state
 * only carries the rows and the chosen key/value columns.
 */
/**
 * A parsed tabular dataset, in one of four shapes:
 *  - **area**: rows joined to bundled geometry by a key → choropleth.
 *  - **point**: rows with lat/lon coordinates → point layer.
 *  - **geo**: the user's own geometry (Shapefile/KML/KMZ/GeoJSON) → drawn
 *    directly, optionally coloured by a value/category in its properties.
 *  - **table**: plain tabular data with no geography → charts only.
 * The `kind` discriminant lets the editor pick the right pipeline; geometry for
 * the area case is loaded lazily from the level definition.
 */
export type DatasetState =
  | AreaDataset
  | PointDataset
  | GeoDataset
  | TableDataset;

interface DatasetBase {
  fileName: string;
  columns: string[];
  rows: Record<string, string>[];
  /** Numeric columns available to map / size by. */
  numericColumns: string[];
}

export interface AreaDataset extends DatasetBase {
  kind: "area";
  geoLevel: GeoLevel;
  /** Column used as the geo join key. */
  keyColumn: string;
  /** Column whose numeric values drive the colour. */
  valueColumn: string;
  /** Optional column used to colour areas by category (category map). */
  categoryColumn?: string;
  /**
   * Optional period column (long/tidy form) enabling the time slider (O3.3).
   * When set, the choropleth shows one frame per distinct period and the editor
   * /embed scrub them. `timeFrames` is the ordered (oldest→newest) frame list.
   */
  timeColumn?: string;
  timeFrames?: string[];
}

export interface PointDataset extends DatasetBase {
  kind: "point";
  /** Column holding the latitude. */
  latColumn: string;
  /** Column holding the longitude. */
  lonColumn: string;
  /** Optional numeric column to size the symbols ("" = uniform size). */
  valueColumn: string;
  /** Optional column to colour points by category. */
  categoryColumn?: string;
  /** Optional label column (place name) shown in tooltips. */
  nameColumn?: string;
}

/** The geometry primitives present in a user-supplied GeoJSON collection. */
export type GeometryKind = "polygon" | "line" | "point";

export interface GeoDataset extends DatasetBase {
  kind: "geo";
  /**
   * The user's geometry, already reprojected to WGS84 (lon/lat). Properties of
   * each feature are mirrored into `rows` (and `columns`) for the data table.
   */
  geojson: GeoJSON.FeatureCollection;
  /** Which geometry primitives the collection contains (drives the layers). */
  geometryKinds: GeometryKind[];
  /** Optional numeric column (from properties) used to colour polygons. */
  valueColumn: string;
  /** Optional column used to colour features by category. */
  categoryColumn?: string;
  /** Optional label column shown in tooltips. */
  nameColumn?: string;
}

/**
 * Plain tabular data with no geographic dimension: a CSV of categories and
 * numbers (e.g. "regione, arrivi" or "anno, valore"). It feeds the chart
 * pipeline only — there is nothing to put on a map. Charts read `columns`/
 * `rows`; the editor lets the operator pick which column is the axis/series.
 */
export interface TableDataset extends DatasetBase {
  kind: "table";
  /** Columns that hold categorical/temporal labels (candidate x-axis). */
  labelColumns: string[];
}

export interface StudioState {
  step: StepId;
  project: ProjectMeta;
  dataSource: DataSourceKind;
  /** id from the visualization catalog (e.g. "choropleth"). */
  vizType: string;
  preset: PresetChoice;
  brand: NewsroomBrand;
  design: DesignSettings;
  /** Active dataset (null until a file is loaded). */
  data: DatasetState | null;
}
