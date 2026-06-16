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
  showTitle: boolean;
  showLegend: boolean;
  showSource: boolean;
  /** Show a tooltip with name + value on hover. */
  tooltip: boolean;
  /** Allow the reader to zoom and pan the published map. */
  zoomPan: boolean;
}

/**
 * A parsed tabular dataset bound to a geographic level for choropleth mapping.
 * Geometry is loaded lazily by the map from the level definition; this state
 * only carries the rows and the chosen key/value columns.
 */
/**
 * A parsed tabular dataset, in one of two shapes:
 *  - **area**: rows joined to bundled geometry by a key → choropleth.
 *  - **point**: rows with lat/lon coordinates → point layer.
 * The `kind` discriminant lets the editor pick the right pipeline; geometry for
 * the area case is loaded lazily from the level definition.
 */
export type DatasetState = AreaDataset | PointDataset;

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
