/**
 * Design capability registry — which Design-panel controls each visualisation
 * exposes (the integration contract between viz types and the Design step).
 *
 * The Design panel renders a control block **only** if the active visualisation
 * declares the matching capability, and the renderer reads the same design
 * fields. Adding a new visualisation therefore means: (1) declare its
 * capabilities here, (2) reuse an existing block or add one guarded by a new
 * capability. This keeps every viz coherent with Design by construction —
 * controls that don't apply never show, and every shown control is wired.
 *
 * Universal sections (texts, font & logo, brand, basemap, interactivity) are
 * always shown and are not gated by a capability.
 */

export type DesignCapability =
  /** Geographic binding for area datasets: geo level + key column. */
  | "geoBinding"
  /** Data label + unit (legend/tooltip text). */
  | "valueLabel"
  /** Sequential/diverging/categorical colour ramp selector. */
  | "colorScale"
  /** Choropleth classification: method, classes, manual breaks, legend, no-data. */
  | "classification"
  /** Category column selector (category map). */
  | "categoryBinding"
  /** Point styling: uniform colour + base size. */
  | "pointStyle"
  /** Custom HTML tooltip template. */
  | "tooltipTemplate"
  /** Reader-facing clickable legend filter (choropleth). */
  | "readerFilters";

/** Capabilities per visualisation type (catalog id → blocks). */
export const VIZ_DESIGN_CAPS: Record<string, DesignCapability[]> = {
  choropleth: ["geoBinding", "valueLabel", "colorScale", "classification", "tooltipTemplate", "readerFilters"],
  points: ["valueLabel", "colorScale", "pointStyle", "tooltipTemplate"],
  // Proportional symbols: area-joined value drawn as sized bubbles at centroids.
  symbol: ["geoBinding", "valueLabel", "colorScale", "pointStyle", "tooltipTemplate"],
  // Category map: areas coloured by a categorical column.
  category: ["geoBinding", "categoryBinding", "colorScale", "tooltipTemplate"],
  locator: ["pointStyle"],
  // User-supplied geometry (Shapefile/KML/KMZ/GeoJSON): polygons coloured by
  // value (graduated) or category, lines/points styled uniformly. Not keyed to
  // a bundled geo level, so no geoBinding; not published, so no readerFilters.
  geo: [
    "valueLabel",
    "categoryBinding",
    "colorScale",
    "classification",
    "pointStyle",
    "tooltipTemplate",
  ],
};

/** Capability set for a visualisation type (empty for unknown types). */
export function designCaps(vizType: string): Set<DesignCapability> {
  return new Set(VIZ_DESIGN_CAPS[vizType] ?? []);
}
