/**
 * Pure factory that maps the editor state to a `DataLayer` for MapPreview.
 *
 * Every visualization type (choropleth, bivariate, spike, 3D extrusion,
 * heatmap, hexbin, cartogram, flow, dot-density, symbol, category, locator,
 * plain points and the user's own geometry) is a branch here. The function is
 * deterministic: given the already-computed joins/aggregations plus the design
 * settings it returns the paint description, with no React, MapLibre or DOM
 * dependency - so it is unit-testable in isolation. It was extracted verbatim
 * from MapCanvas's `dataLayer` memo; the branch order is significant (the first
 * matching branch wins).
 */
import type { DataLayer } from "../components/MapPreview";
import type { DatasetState, DesignSettings } from "../studio/types";
import {
  GEO_LEVELS,
  joinChoropleth,
  joinCategory,
  buildFillColorExpression,
  computeBreaks,
  DEFAULT_NO_DATA_COLOR,
} from "./choropleth";
import {
  buildPointFeatures,
  buildPointColorExpression,
  buildPointRadiusExpression,
} from "./points";
import { prepareGeoRender } from "./geo-dataset";
import {
  joinBivariate,
  buildBivariateColorExpression,
  bivariatePaletteColors,
} from "./bivariate";
import { spikeTriangles } from "./spike";
import { hexbin } from "./hexbin";
import { buildHeatmapPaint } from "./heatmap";
import { nonContiguousCartogram, dorlingCartogram } from "./cartogram";
import { buildFlows } from "./flow";

const NO_DATA_COLOR = DEFAULT_NO_DATA_COLOR;

/** Symbol-map bubbles: point features plus the value range for radius scaling. */
export interface SymbolPoints {
  geojson: GeoJSON.FeatureCollection;
  valueRange: { min: number; max: number } | undefined;
}

/** All inputs the factory needs, named exactly as in the source memo. */
export interface BuildDataLayerArgs {
  vizType: string;
  /** Choropleth join actually rendered (single or current temporal frame). */
  choro: ReturnType<typeof joinChoropleth> | null;
  /** Plain numeric area join (drives extrusion, spike, cartogram, symbol). */
  joined: ReturnType<typeof joinChoropleth> | null;
  bivariate: ReturnType<typeof joinBivariate> | null;
  spike: ReturnType<typeof spikeTriangles> | null;
  points: ReturnType<typeof buildPointFeatures> | null;
  hexbinResult: ReturnType<typeof hexbin> | null;
  hexbinClasses: ReturnType<typeof computeBreaks> | null;
  cartogram:
    | ReturnType<typeof nonContiguousCartogram>
    | ReturnType<typeof dorlingCartogram>
    | null;
  flow: ReturnType<typeof buildFlows> | null;
  symbolPoints: SymbolPoints | null;
  categoryJoin: ReturnType<typeof joinCategory> | null;
  geoRender: ReturnType<typeof prepareGeoRender> | null;
  scaleColors: string[];
  data: DatasetState | null;
  valueLabel: string;
  design: DesignSettings;
  /** Categorical fallback palette (used when the chosen scale is empty). */
  catPalette: string[];
}

export function buildDataLayer(args: BuildDataLayerArgs): DataLayer | null {
  const {
    vizType,
    choro,
    joined,
    bivariate,
    spike,
    points,
    hexbinResult,
    hexbinClasses,
    cartogram,
    flow,
    symbolPoints,
    categoryJoin,
    geoRender,
    scaleColors,
    data,
    valueLabel,
    design,
    catPalette: CAT_PALETTE,
  } = args;

  // Choropleth: graduated fill.
  if (vizType === "choropleth" && choro) {
    const fillColor = buildFillColorExpression(
      choro.classes,
      scaleColors,
      NO_DATA_COLOR,
    );
    return {
      kind: "area",
      geojson: choro.geojson,
      fillColor,
      nameField:
        data?.kind === "area" ? GEO_LEVELS[data.geoLevel].nameField : undefined,
      valueLabel,
      valueUnit: design.valueUnit || undefined,
      tooltipTemplate: design.tooltipTemplate,
    };
  }
  // Bivariate map: two variables → a 3×3 colour matrix on the areas.
  if (vizType === "bivariate" && bivariate) {
    // Resolve variable B's column name exactly as the bivariate join does, so
    // the tooltip labels match the legend axes.
    const colA = data?.kind === "area" ? data.valueColumn : "";
    const colB =
      data?.kind === "area"
        ? design.bivariateColumn2 && data.numericColumns.includes(design.bivariateColumn2)
          ? design.bivariateColumn2
          : data.numericColumns.find((c) => c !== colA) ?? ""
        : "";
    return {
      kind: "area",
      geojson: bivariate.geojson,
      fillColor: buildBivariateColorExpression(
        bivariatePaletteColors(design.bivariatePalette),
        NO_DATA_COLOR,
      ),
      nameField:
        data?.kind === "area" ? GEO_LEVELS[data.geoLevel].nameField : undefined,
      valueLabel,
      valueUnit: design.valueUnit || undefined,
      tooltipTemplate: design.tooltipTemplate,
      bivariate: {
        labelA: valueLabel || colA || "Variabile 1",
        labelB: design.valueLabel2 || colB || "Variabile 2",
        unitB: design.valueUnit2 || undefined,
      },
    };
  }
  // Spike map: triangles at centroids, height ∝ value, uniform colour.
  if (vizType === "spike" && spike) {
    return {
      kind: "area",
      geojson: spike,
      fillColor: design.pointColor,
      lineColor: design.pointColor,
      nameField: "__name",
      valueLabel,
      valueUnit: design.valueUnit || undefined,
      tooltipTemplate: design.tooltipTemplate,
    };
  }
  // 3D extrusion: areas raised by value, graduated colour. Needs map pitch.
  if (vizType === "extrusion" && joined) {
    return {
      kind: "extrusion",
      geojson: joined.geojson,
      fillColor: buildFillColorExpression(joined.classes, scaleColors, NO_DATA_COLOR),
      extrusionRange: { min: joined.classes.min, max: joined.classes.max },
      extrusionMaxHeight: Math.round(120000 * (design.extrusionScale ?? 1)),
      nameField:
        data?.kind === "area" ? GEO_LEVELS[data.geoLevel].nameField : undefined,
      valueLabel,
      valueUnit: design.valueUnit || undefined,
      tooltipTemplate: design.tooltipTemplate,
    };
  }
  // Heatmap: density surface from the point cloud.
  if (vizType === "heatmap" && points && data?.kind === "point") {
    return {
      kind: "heatmap",
      geojson: points.geojson,
      heatmapPaint: buildHeatmapPaint({
        valueRange: points.valueRange,
        colors: scaleColors,
        radius: Math.max(10, design.pointSize * 2.4),
      }),
    };
  }
  // Hexbin: aggregated density hexagons, classified like a choropleth.
  if (vizType === "hexbin" && hexbinResult && hexbinClasses) {
    return {
      kind: "area",
      geojson: hexbinResult.geojson,
      fillColor: buildFillColorExpression(hexbinClasses, scaleColors, NO_DATA_COLOR),
      valueLabel: valueLabel || "Conteggio",
      valueUnit: design.valueUnit || undefined,
      tooltipTemplate: design.tooltipTemplate,
    };
  }
  // Cartogram: deformed areas (non-contiguous) or Dorling circles, both
  // coloured by value with the choropleth classes.
  if (vizType === "cartogram" && cartogram && joined) {
    const fillColor = buildFillColorExpression(joined.classes, scaleColors, NO_DATA_COLOR);
    return {
      kind: "area",
      geojson: cartogram,
      fillColor,
      nameField:
        design.cartogramKind === "dorling"
          ? "__name"
          : data?.kind === "area"
            ? GEO_LEVELS[data.geoLevel].nameField
            : undefined,
      valueLabel,
      valueUnit: design.valueUnit || undefined,
      tooltipTemplate: design.tooltipTemplate,
    };
  }
  // Flow map: arcs drawn as lines, coloured/sized by value.
  if (vizType === "flow" && flow) {
    const expr = flow.valueRange
      ? buildFillColorExpression(
          computeBreaks(
            flow.geojson.features
              .map((f) => (f.properties as Record<string, unknown>).__value)
              .filter((v): v is number => typeof v === "number"),
            design.classification,
            design.nClasses,
            design.manualBreaks,
          ),
          scaleColors,
          NO_DATA_COLOR,
        )
      : design.pointColor;
    return {
      kind: "geo",
      geojson: flow.geojson,
      lineColorExpr: expr,
      circleColor: design.pointColor,
      circleRadius: 0,
      nameField: "__name",
      valueLabel,
      valueUnit: design.valueUnit || undefined,
      tooltipTemplate: design.tooltipTemplate,
    };
  }
  // Dot density: one small translucent dot per event (no aggregation).
  if (vizType === "dotdensity" && points && data?.kind === "point") {
    const categoryPalette = scaleColors.length > 0 ? scaleColors : CAT_PALETTE;
    return {
      kind: "point",
      geojson: points.geojson,
      circleColor: data.categoryColumn
        ? buildPointColorExpression(points.categories, categoryPalette, design.pointColor)
        : design.pointColor,
      circleRadius: Math.max(2, design.pointSize * 0.45),
      circleOpacity: 0.55,
      nameField: data.nameColumn || data.categoryColumn ? "__name" : undefined,
      valueLabel,
      valueUnit: design.valueUnit || undefined,
      tooltipTemplate: design.tooltipTemplate,
    };
  }
  // Symbol map: sized bubbles at centroids, single colour.
  if (vizType === "symbol" && symbolPoints) {
    return {
      kind: "point",
      geojson: symbolPoints.geojson,
      circleColor: design.pointColor,
      circleRadius: buildPointRadiusExpression(
        symbolPoints.valueRange,
        Math.max(2, design.pointSize * 0.6),
        design.pointSize * 2.8,
        design.pointSize,
      ),
      nameField: "__name",
      valueLabel,
      valueUnit: design.valueUnit || undefined,
      tooltipTemplate: design.tooltipTemplate,
    };
  }
  // Category map: areas coloured by category.
  if (vizType === "category" && categoryJoin) {
    const palette = scaleColors.length > 0 ? scaleColors : CAT_PALETTE;
    return {
      kind: "area",
      geojson: categoryJoin.geojson,
      fillColor: buildPointColorExpression(
        categoryJoin.categories,
        palette,
        NO_DATA_COLOR,
      ),
      nameField:
        data?.kind === "area" ? GEO_LEVELS[data.geoLevel].nameField : undefined,
      valueLabel: data?.kind === "area" ? data.categoryColumn ?? "" : "",
      tooltipTemplate: design.tooltipTemplate,
    };
  }
  // Locator map: pins with always-on labels on a base map. Uses the point
  // dataset, uniform size (it's about *where*, not magnitude), labels from
  // the chosen name column.
  if (vizType === "locator" && points && data?.kind === "point") {
    const categoryPalette = scaleColors.length > 0 ? scaleColors : CAT_PALETTE;
    return {
      kind: "point",
      geojson: points.geojson,
      circleColor: data.categoryColumn
        ? buildPointColorExpression(
            points.categories,
            categoryPalette,
            design.pointColor,
          )
        : design.pointColor,
      circleRadius: Math.max(4, design.pointSize),
      nameField: "__name",
      showLabels: true,
      valueLabel,
      valueUnit: design.valueUnit || undefined,
      tooltipTemplate: design.tooltipTemplate,
    };
  }
  // Point dataset.
  if (points && data?.kind === "point") {
    const categoryPalette = scaleColors.length > 0 ? scaleColors : CAT_PALETTE;
    return {
      kind: "point",
      geojson: points.geojson,
      circleColor: data.categoryColumn
        ? buildPointColorExpression(
            points.categories,
            categoryPalette,
            design.pointColor,
          )
        : design.pointColor,
      circleRadius: buildPointRadiusExpression(
        points.valueRange,
        Math.max(2, design.pointSize * 0.6),
        design.pointSize * 2.6,
        design.pointSize,
      ),
      nameField: data.nameColumn || data.categoryColumn ? "__name" : undefined,
      valueLabel,
      valueUnit: design.valueUnit || undefined,
      tooltipTemplate: design.tooltipTemplate,
    };
  }
  // User "geo" dataset: draw the uploaded geometry. Polygons are coloured by
  // value (graduated) or category; lines/points get a single colour/category.
  if (data?.kind === "geo" && geoRender) {
    const palette = scaleColors.length > 0 ? scaleColors : CAT_PALETTE;
    const hasValue = !!data.valueColumn && geoRender.values.length > 0;
    const hasCategory = !!data.categoryColumn && geoRender.categories.length > 0;

    let fillColor: unknown = design.pointColor;
    let lineColorExpr: unknown = undefined;
    let circleColor: unknown = design.pointColor;
    if (hasValue) {
      const classes = computeBreaks(
        geoRender.values,
        design.classification,
        design.nClasses,
        design.manualBreaks,
      );
      fillColor = buildFillColorExpression(classes, scaleColors, NO_DATA_COLOR);
    } else if (hasCategory) {
      const expr = buildPointColorExpression(
        geoRender.categories,
        palette,
        design.pointColor,
      );
      fillColor = expr;
      lineColorExpr = expr;
      circleColor = expr;
    }
    return {
      kind: "geo",
      geojson: geoRender.geojson,
      fillColor,
      lineColorExpr,
      circleColor,
      circleRadius: design.pointSize,
      nameField: data.nameColumn || data.categoryColumn ? "__name" : undefined,
      valueLabel,
      valueUnit: design.valueUnit || undefined,
      tooltipTemplate: design.tooltipTemplate,
    };
  }
  return null;
}
