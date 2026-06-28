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
  | "readerFilters"
  /** Chart axes: x/y/series column pickers + value label. */
  | "chartAxes"
  /** Bivariate map: pick the second value column. */
  | "bivariateBinding"
  /** Cartogram: pick the variant (non-contiguous / Dorling). */
  | "cartogramKind"
  /** Flow map: pick the origin/destination coordinate columns. */
  | "flowBinding";

/** Capabilities per visualisation type (catalog id → blocks). */
export const VIZ_DESIGN_CAPS: Record<string, DesignCapability[]> = {
  choropleth: ["geoBinding", "valueLabel", "colorScale", "classification", "tooltipTemplate", "readerFilters"],
  points: ["valueLabel", "colorScale", "pointStyle", "tooltipTemplate"],
  // Proportional symbols: area-joined value drawn as sized bubbles at centroids.
  symbol: ["geoBinding", "valueLabel", "colorScale", "pointStyle", "tooltipTemplate"],
  // Category map: areas coloured by a categorical column.
  category: ["geoBinding", "categoryBinding", "colorScale", "tooltipTemplate"],
  locator: ["pointStyle"],
  // Cartogram: areas resized by value (non-contiguous) or Dorling circles.
  cartogram: ["cartogramKind", "valueLabel", "colorScale", "classification", "tooltipTemplate"],
  // Flow map: arcs between origin/destination coordinate pairs.
  flow: ["flowBinding", "valueLabel", "colorScale", "pointStyle", "tooltipTemplate"],
  // Bivariate map: two variables → a selectable 3×3 colour matrix (no colour ramp).
  bivariate: ["valueLabel", "bivariateBinding", "tooltipTemplate"],
  // Spike map: triangles at centroids, uniform colour + width (pointStyle).
  spike: ["valueLabel", "colorScale", "pointStyle", "tooltipTemplate"],
  // 3D extrusion: areas raised by value, graduated colour + classes.
  extrusion: ["valueLabel", "colorScale", "classification", "tooltipTemplate"],
  // Heatmap: density surface from points, coloured by a ramp + radius.
  heatmap: ["colorScale", "pointStyle"],
  // Hexbin: aggregated density hexagons, classified like a choropleth.
  hexbin: ["colorScale", "classification"],
  // Dot density: one dot per event, styled colour + size + category.
  dotdensity: ["pointStyle", "categoryBinding"],
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
  // Charts: pick axes (x/y/series) + colour scale. No geography.
  bar: ["chartAxes", "colorScale"],
  line: ["chartAxes", "colorScale"],
  area: ["chartAxes", "colorScale"],
  scatter: ["chartAxes", "colorScale"],
  // Rich table: no design controls beyond the universal sections.
  table: [],
};

/** Capability set for a visualisation type (empty for unknown types). */
export function designCaps(vizType: string): Set<DesignCapability> {
  return new Set(VIZ_DESIGN_CAPS[vizType] ?? []);
}

/**
 * Visualisations that render on a MapLibre map and therefore support the 3D
 * globe projection toggle (every map type; charts and the table do not).
 */
export const MAP_VIZ_TYPES = new Set<string>([
  "choropleth",
  "points",
  "locator",
  "symbol",
  "category",
  "bivariate",
  "dotdensity",
  "heatmap",
  "hexbin",
  "spike",
  "cartogram",
  "flow",
  "extrusion",
  "raster",
]);

/**
 * Whether the active visualisation can be rendered on the 3D globe. True for
 * any map viz type, and for custom-geometry datasets (which always publish as a
 * map regardless of the chosen catalog id).
 */
export function supportsGlobe(vizType: string, dataKind?: string): boolean {
  return MAP_VIZ_TYPES.has(vizType) || dataKind === "geo";
}
