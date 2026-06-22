import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
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
  computeBreaks,
  temporalSharedValues,
  sampleColors,
  DEFAULT_NO_DATA_COLOR,
} from "../lib/choropleth";
import {
  buildPointFeatures,
  buildPointColorExpression,
  buildPointRadiusExpression,
} from "../lib/points";
import { prepareGeoRender } from "../lib/geo-dataset";
import { featureCentroid } from "../lib/centroid";
import { templateColumns } from "../lib/tooltip";
import { buildClassVisibilityFilter, classLabel } from "../lib/class-filter";
import { rowsForFrame, frameLabel } from "../lib/temporal";

const NO_DATA_COLOR = DEFAULT_NO_DATA_COLOR;
/** Categorical palette for point/category colouring (falls back to teal). */
const CAT_PALETTE =
  COLOR_SCALES.find((s) => s.id === "cat")?.colors ?? ["#01646f"];

export function MapCanvas() {
  const { project, brand, vizType, design, data, exportNodeRef, timeIndex, setTimeIndex } =
    useStudio();
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

  // --- Temporal choropleth (O3.3) ------------------------------------------
  // A temporal area dataset carries a period column + ordered frames. The
  // slider scrubs frames; the classification is computed ONCE over every
  // frame's matched values so a colour means the same value across time.
  const temporalArea =
    data?.kind === "area" &&
    !!data.timeColumn &&
    (data.timeFrames?.length ?? 0) >= 2 &&
    vizType === "choropleth";
  const frames = temporalArea ? data!.timeFrames! : null;
  const frameIdx = frames ? Math.min(Math.max(0, timeIndex), frames.length - 1) : 0;
  const currentFrame = frames ? frames[frameIdx] : null;

  // Shared classification across all frames (comparable colours over time).
  const temporalClasses = useMemo(() => {
    if (!temporalArea || !rawGeo || data?.kind !== "area" || !data.timeColumn || !data.timeFrames)
      return null;
    const values = temporalSharedValues({
      geojson: rawGeo,
      level: data.geoLevel,
      rows: data.rows,
      keyColumn: data.keyColumn,
      valueColumn: data.valueColumn,
      timeColumn: data.timeColumn,
      frames: data.timeFrames,
    });
    return computeBreaks(values, design.classification, design.nClasses, design.manualBreaks);
  }, [temporalArea, rawGeo, data, design.classification, design.nClasses, design.manualBreaks]);

  // Join the rows of the CURRENT frame onto the geometry (geometry + __value).
  const temporalJoined = useMemo(() => {
    if (!temporalArea || !rawGeo || data?.kind !== "area" || !data.timeColumn || !currentFrame)
      return null;
    return joinChoropleth({
      geojson: rawGeo,
      level: data.geoLevel,
      rows: rowsForFrame(data.rows, data.timeColumn, currentFrame),
      keyColumn: data.keyColumn,
      valueColumn: data.valueColumn,
      nClasses: design.nClasses,
      method: design.classification,
      manualBreaks: design.manualBreaks,
      extraColumns: tooltipCols,
    });
  }, [temporalArea, rawGeo, currentFrame, data, design.nClasses, design.classification, design.manualBreaks, tooltipCols]);

  // The choropleth join actually used downstream: the current frame's geometry
  // with the SHARED classes (temporal), or the plain single join otherwise.
  const choro =
    temporalArea && temporalJoined && temporalClasses
      ? {
          geojson: temporalJoined.geojson,
          classes: temporalClasses,
          matched: temporalJoined.matched,
          unmatchedCsv: temporalJoined.unmatchedCsv,
          noDataFeatures: temporalJoined.noDataFeatures,
        }
      : joined;

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

  // Prepare a user "geo" dataset (its own geometry) for rendering: inject
  // __value/__cat/__name so the paint expressions can read them.
  const geoRender = useMemo(() => {
    if (!data || data.kind !== "geo") return null;
    return prepareGeoRender(data, tooltipCols);
  }, [data, tooltipCols]);

  const valueLabel =
    (design.valueLabel ||
      (data && data.kind !== "table" ? data.valueColumn : "")) ??
    "";

  const dataLayer: DataLayer | null = useMemo(() => {
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
    // User "geo" dataset: draw the uploaded geometry. Polygons are coloured by
    // value (graduated) or category; lines/points get a single colour/category.
    if (data?.kind === "geo" && geoRender) {
      const palette = scaleColors.length > 0 ? scaleColors : CAT_PALETTE;
      const hasValue = !!data.valueColumn && geoRender.values.length > 0;
      const hasCategory =
        !!data.categoryColumn && geoRender.categories.length > 0;

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
  }, [vizType, joined, choro, symbolPoints, categoryJoin, points, geoRender, scaleColors, data, valueLabel, design.valueUnit, design.pointColor, design.pointSize, design.tooltipTemplate, design.classification, design.nClasses, design.manualBreaks]);

  const showLegend =
    design.showLegend && vizType === "choropleth";

  // Reader class filter (clickable legend). Only meaningful for the choropleth.
  const filtersOn = design.readerFilters && vizType === "choropleth" && !!choro;
  const [hiddenClasses, setHiddenClasses] = useState<Set<number>>(new Set());
  // Reset the hidden set whenever the classification or dataset changes.
  const classKey = choro ? choro.classes.breaks.join(",") : "";
  useEffect(() => {
    setHiddenClasses(new Set());
  }, [classKey, vizType, design.readerFilters]);
  const toggleClass = (i: number) =>
    setHiddenClasses((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  const dataFilter = useMemo(
    () =>
      filtersOn && choro
        ? buildClassVisibilityFilter(choro.classes.breaks, hiddenClasses)
        : null,
    [filtersOn, choro, hiddenClasses],
  );

  // Time-slider playback. `playing` is local; stepping reads the current index
  // from a ref so the interval always advances from the latest frame.
  const [playing, setPlaying] = useState(false);
  const frameIdxRef = useRef(frameIdx);
  frameIdxRef.current = frameIdx;
  useEffect(() => {
    if (!temporalArea) setPlaying(false);
  }, [temporalArea]);
  useEffect(() => {
    if (!playing || !frames) return;
    const id = window.setInterval(() => {
      const next = frameIdxRef.current + 1 >= frames.length ? 0 : frameIdxRef.current + 1;
      setTimeIndex(next);
    }, 900);
    return () => window.clearInterval(id);
  }, [playing, frames, setTimeIndex]);

  // Resolve the chosen basemap. OpenFreeMap styles load by URL (no hosting/key);
  // "none"/"custom" → no basemap (transparent background).
  const basemapDef = MAP_BASEMAPS.find((b) => b.id === design.basemap);
  const basemapUrl = basemapDef?.styleUrl ?? null;
  const hasBasemap = Boolean(basemapUrl);

  const legendColors = choro
    ? sampleColors(scaleColors, choro.classes.breaks.length + 1)
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
        dataFilter={dataFilter}
        fitKey={
          data
            ? data.kind === "area"
              ? `${data.fileName}:${data.geoLevel}:${data.valueColumn}`
              : data.kind === "point"
                ? `${data.fileName}:point:${data.latColumn},${data.lonColumn}`
                : data.kind === "geo"
                  ? `${data.fileName}:geo:${data.valueColumn}`
                  : data.fileName
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
          <div
            className={`rounded-lg bg-white/92 px-3 py-2 shadow-md ring-1 ring-black/5 backdrop-blur ${
              filtersOn ? "pointer-events-auto" : ""
            }`}
          >
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {valueLabel || "Legenda"}
            </p>
            {design.legendType === "steps" ? (
              filtersOn && choro ? (
                <div className="flex flex-col gap-0.5">
                  {legendColors.map((c, i) => {
                    const hidden = hiddenClasses.has(i);
                    return (
                      <button
                        key={`${c}-${i}`}
                        onClick={() => toggleClass(i)}
                        title={hidden ? "Mostra questa classe" : "Nascondi questa classe"}
                        className={`flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-[10px] transition-opacity hover:bg-slate-100 ${
                          hidden ? "opacity-35" : ""
                        }`}
                      >
                        <span
                          className="inline-block h-2.5 w-4 flex-shrink-0 rounded-sm"
                          style={{ background: c }}
                        />
                        <span className="text-slate-600">
                          {classLabel(choro.classes.breaks, i, (n) =>
                            formatNum(n, design.valueUnit),
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex h-2.5 w-40 overflow-hidden rounded-full">
                  {legendColors.map((c, i) => (
                    <span key={`${c}-${i}`} className="flex-1" style={{ background: c }} />
                  ))}
                </div>
              )
            ) : (
              <div
                className="h-2.5 w-40 rounded-full"
                style={{
                  background: `linear-gradient(to right, ${scaleColors.join(", ")})`,
                }}
              />
            )}
            <div className="mt-1 flex justify-between text-[10px] text-slate-500">
              <span>{choro ? formatNum(choro.classes.min, design.valueUnit) : "min"}</span>
              <span>{choro ? formatNum(choro.classes.max, design.valueUnit) : "max"}</span>
            </div>
            {choro && choro.noDataFeatures > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: NO_DATA_COLOR }}
                />
                Dato non disponibile ({choro.noDataFeatures})
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

      {/* Time slider (bottom-centre) for a temporal choropleth. */}
      {temporalArea && frames && currentFrame && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 w-[min(440px,82%)] -translate-x-1/2">
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl bg-white/92 px-3 py-2 shadow-lg ring-1 ring-black/5 backdrop-blur">
            <button
              onClick={() => setPlaying((p) => !p)}
              title={playing ? "Pausa" : "Riproduci l'animazione"}
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-zornade text-white transition-colors hover:bg-zornade-700"
            >
              {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
            </button>
            <input
              type="range"
              min={0}
              max={frames.length - 1}
              value={frameIdx}
              onChange={(e) => {
                setPlaying(false);
                setTimeIndex(Number(e.target.value));
              }}
              aria-label="Periodo"
              className="h-1 flex-1 cursor-pointer accent-zornade"
            />
            <span className="w-14 flex-shrink-0 text-right text-xs font-semibold tabular-nums text-slate-700">
              {frameLabel(currentFrame)}
            </span>
          </div>
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

