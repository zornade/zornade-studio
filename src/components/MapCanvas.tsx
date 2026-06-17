import { useEffect, useMemo, useState } from "react";
import { makeFlavor } from "../basemap";
import { useStudio } from "../studio/StudioContext";
import { COLOR_SCALES, MAP_BASEMAPS } from "../studio/catalog";
import { MapPreview, type DataLayer } from "./MapPreview";
import { TILES_URL } from "../lib/tiles";
import {
  GEO_LEVELS,
  joinChoropleth,
  joinCategory,
  buildFillColorExpression,
  sampleColors,
  DEFAULT_NO_DATA_COLOR,
} from "../lib/choropleth";
import {
  buildPointFeatures,
  buildPointColorExpression,
  buildPointRadiusExpression,
} from "../lib/points";
import { featureCentroid } from "../lib/centroid";
import { templateColumns } from "../lib/tooltip";

const NO_DATA_COLOR = DEFAULT_NO_DATA_COLOR;
/** Categorical palette for point/category colouring (falls back to teal). */
const CAT_PALETTE =
  COLOR_SCALES.find((s) => s.id === "cat")?.colors ?? ["#01646f"];

export function MapCanvas() {
  const { project, brand, vizType, design, data, exportNodeRef } = useStudio();
  const flavor = useMemo(() => makeFlavor(brand), [brand]);

  const scale =
    COLOR_SCALES.find((s) => s.id === design.colorScale) ?? COLOR_SCALES[0];
  // Colours actually used, with the optional reverse applied once here so the
  // fill, the symbols, the categories and the legend all stay consistent.
  const scaleColors = design.reverseScale
    ? [...scale.colors].reverse()
    : scale.colors;

  // Columns referenced by a custom tooltip template, restricted to real columns
  // → carried onto the features so the tooltip can fill {colonna} tokens.
  const tooltipCols = useMemo(
    () =>
      data
        ? templateColumns(design.tooltipTemplate).filter((c) =>
            data.columns.includes(c),
          )
        : [],
    [data, design.tooltipTemplate],
  );

  // Load the geometry for the active dataset's geo level (area datasets only).
  const [rawGeo, setRawGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const geoUrl = data?.kind === "area" ? GEO_LEVELS[data.geoLevel].url : null;
  useEffect(() => {
    if (!geoUrl) {
      setRawGeo(null);
      return;
    }
    let cancelled = false;
    fetch(geoUrl)
      .then((r) => r.json())
      .then((g) => {
        if (!cancelled) setRawGeo(g as GeoJSON.FeatureCollection);
      })
      .catch(() => {
        if (!cancelled) setRawGeo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [geoUrl]);

  // Numeric area join: feeds the choropleth (graduated fill) AND the symbol map
  // (bubble size). Same join, two renderings.
  const joined = useMemo(() => {
    if (!data || data.kind !== "area" || !rawGeo) return null;
    if (vizType !== "choropleth" && vizType !== "symbol") return null;
    return joinChoropleth({
      geojson: rawGeo,
      level: data.geoLevel,
      rows: data.rows,
      keyColumn: data.keyColumn,
      valueColumn: data.valueColumn,
      nClasses: design.nClasses,
      method: design.classification,
      manualBreaks: design.manualBreaks,
      extraColumns: tooltipCols,
    });
  }, [data, rawGeo, vizType, design.nClasses, design.classification, design.manualBreaks, tooltipCols]);

  // Category area join: feeds the category map (colour per category).
  const categoryJoin = useMemo(() => {
    if (!data || data.kind !== "area" || !rawGeo || vizType !== "category")
      return null;
    if (!data.categoryColumn) return null;
    return joinCategory({
      geojson: rawGeo,
      level: data.geoLevel,
      rows: data.rows,
      keyColumn: data.keyColumn,
      categoryColumn: data.categoryColumn,
    });
  }, [data, rawGeo, vizType]);

  // Symbol map: place a sized bubble at each matched area's centroid.
  const symbolPoints = useMemo(() => {
    if (vizType !== "symbol" || !joined || data?.kind !== "area") return null;
    const nameField = GEO_LEVELS[data.geoLevel].nameField;
    const features: GeoJSON.Feature[] = [];
    let min = Infinity;
    let max = -Infinity;
    for (const f of joined.geojson.features) {
      const v = (f.properties as Record<string, unknown>)?.__value;
      if (typeof v !== "number") continue;
      const c = featureCentroid(f.geometry);
      if (!c) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      const fp = (f.properties as Record<string, unknown>) ?? {};
      const props: Record<string, unknown> = {
        __value: v,
        __name: fp[nameField] ?? "",
      };
      // Carry template-referenced columns (col:*) onto the bubble.
      for (const k of Object.keys(fp)) {
        if (k.startsWith("col:")) props[k] = fp[k];
      }
      features.push({
        type: "Feature",
        properties: props,
        geometry: { type: "Point", coordinates: c },
      });
    }
    const valueRange =
      Number.isFinite(min) && Number.isFinite(max) ? { min, max } : undefined;
    return {
      geojson: { type: "FeatureCollection", features } as GeoJSON.FeatureCollection,
      valueRange,
    };
  }, [vizType, joined, data]);

  // Build point features for a point dataset (memoised on the relevant inputs).
  const points = useMemo(() => {
    if (!data || data.kind !== "point") return null;
    return buildPointFeatures({
      rows: data.rows,
      latColumn: data.latColumn,
      lonColumn: data.lonColumn,
      valueColumn: data.valueColumn || undefined,
      categoryColumn: data.categoryColumn,
      nameColumn: data.nameColumn ?? data.categoryColumn,
      extraColumns: tooltipCols,
    });
  }, [data, tooltipCols]);

  const valueLabel =
    (design.valueLabel || (data?.kind === "point" ? data.valueColumn : data?.valueColumn)) ??
    "";

  const dataLayer: DataLayer | null = useMemo(() => {
    // Choropleth: graduated fill.
    if (vizType === "choropleth" && joined) {
      const fillColor = buildFillColorExpression(
        joined.classes,
        scaleColors,
        NO_DATA_COLOR,
      );
      return {
        kind: "area",
        geojson: joined.geojson,
        fillColor,
        nameField: data?.kind === "area" ? GEO_LEVELS[data.geoLevel].nameField : undefined,
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
        nameField: data?.kind === "area" ? GEO_LEVELS[data.geoLevel].nameField : undefined,
        valueLabel: data?.kind === "area" ? data.categoryColumn ?? "" : "",
        tooltipTemplate: design.tooltipTemplate,
      };
    }
    // Point dataset.
    if (points && data?.kind === "point") {
      const categoryPalette =
        scaleColors.length > 0 ? scaleColors : CAT_PALETTE;
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
    return null;
  }, [vizType, joined, symbolPoints, categoryJoin, points, scaleColors, data, valueLabel, design.valueUnit, design.pointColor, design.pointSize, design.tooltipTemplate]);

  const showLegend =
    design.showLegend && vizType === "choropleth";

  // Resolve the chosen basemap. OpenFreeMap styles load by URL (no hosting/key);
  // "none"/"custom" → no basemap (transparent background).
  const basemapDef = MAP_BASEMAPS.find((b) => b.id === design.basemap);
  const basemapUrl = basemapDef?.styleUrl ?? null;
  const hasBasemap = Boolean(basemapUrl);

  const legendColors = joined
    ? sampleColors(scaleColors, joined.classes.breaks.length + 1)
    : scaleColors;

  return (
    <div
      ref={(node) => {
        exportNodeRef.current = node;
      }}
      className={`relative h-full w-full overflow-hidden ${
        hasBasemap ? "bg-slate-100" : "studio-transparent-bg"
      }`}
    >
      <MapPreview
        tilesUrl={TILES_URL}
        flavor={flavor}
        lang="it"
        dataLayer={dataLayer}
        tooltip={design.tooltip}
        zoomPan={design.zoomPan}
        basemap={false}
        basemapUrl={basemapUrl}
        fitKey={
          data
            ? data.kind === "area"
              ? `${data.fileName}:${data.geoLevel}:${data.valueColumn}`
              : `${data.fileName}:point:${data.latColumn},${data.lonColumn}`
            : null
        }
      />

      {/* Title / subtitle overlay (top-left). */}
      {design.showTitle && (
        <div className="pointer-events-none absolute left-4 top-4 max-w-sm">
          <div className="pointer-events-auto rounded-xl bg-white/92 px-4 py-3 shadow-lg ring-1 ring-black/5 backdrop-blur">
            <h2
              className="text-lg font-semibold leading-tight text-slate-900"
              style={{ fontFamily: design.titleFont }}
            >
              {project.title || "Mappa senza titolo"}
            </h2>
            {project.subtitle && (
              <p
                className="mt-1 text-sm text-slate-600"
                style={{ fontFamily: design.titleFont }}
              >
                {project.subtitle}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Legend (bottom-left), driven by the chosen data color scale. */}
      {showLegend && (
        <div className="pointer-events-none absolute bottom-8 left-4">
          <div className="rounded-lg bg-white/92 px-3 py-2 shadow-md ring-1 ring-black/5 backdrop-blur">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {valueLabel || "Legenda"}
            </p>
            {design.legendType === "steps" ? (
              <div className="flex h-2.5 w-40 overflow-hidden rounded-full">
                {legendColors.map((c, i) => (
                  <span key={`${c}-${i}`} className="flex-1" style={{ background: c }} />
                ))}
              </div>
            ) : (
              <div
                className="h-2.5 w-40 rounded-full"
                style={{
                  background: `linear-gradient(to right, ${scaleColors.join(", ")})`,
                }}
              />
            )}
            <div className="mt-1 flex justify-between text-[10px] text-slate-500">
              <span>{joined ? formatNum(joined.classes.min, design.valueUnit) : "min"}</span>
              <span>{joined ? formatNum(joined.classes.max, design.valueUnit) : "max"}</span>
            </div>
            {joined && joined.noDataFeatures > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: NO_DATA_COLOR }}
                />
                Dato non disponibile ({joined.noDataFeatures})
              </div>
            )}
          </div>
        </div>
      )}

      {/* Source line (bottom-left, under map). */}
      {design.showSource && (
        <div className="pointer-events-none absolute bottom-2 left-4 text-[11px] text-slate-500">
          {project.source}
        </div>
      )}
    </div>
  );
}

/** Compact number formatting for legend bounds (Italian locale). */
function formatNum(n: number, unit?: string): string {
  const s = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(n);
  return unit ? `${s}\u00a0${unit}` : s;
}

