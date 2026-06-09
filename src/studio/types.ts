import type { NewsroomBrand } from "../basemap";
import type { PresetChoice } from "./catalog";

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
  /** id of the data color scale (see COLOR_SCALES). */
  colorScale: string;
  /** id of the classification method (see CLASSIFICATION_METHODS). */
  classification: string;
  /** id of the legend type (see LEGEND_TYPES). */
  legendType: string;
  showTitle: boolean;
  showLegend: boolean;
  showSource: boolean;
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
}
