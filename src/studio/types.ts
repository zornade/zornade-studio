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
export interface DatasetState {
  fileName: string;
  columns: string[];
  rows: Record<string, string>[];
  geoLevel: GeoLevel;
  /** CSV column used as the geo join key. */
  keyColumn: string;
  /** CSV column whose numeric values drive the colour. */
  valueColumn: string;
  /** Numeric columns available to map. */
  numericColumns: string[];
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
