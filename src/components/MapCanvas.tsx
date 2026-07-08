import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { makeFlavor } from "../basemap";
import { useStudio } from "../studio/StudioContext";
import { COLOR_SCALES } from "../studio/catalog";
import { resolveBasemap, BRAND_TEAL } from "../studio/palettes";
import { MapPreview, type DataLayer } from "./MapPreview";
import { TILES_URL } from "../lib/tiles";
import {
  GEO_LEVELS,
  joinChoropleth,
  joinCategory,
  computeBreaks,
  temporalSharedValues,
  sampleColors,
  DEFAULT_NO_DATA_COLOR,
} from "../lib/choropleth";
import { buildPointFeatures } from "../lib/points";
import { prepareGeoRender } from "../lib/geo-dataset";
import { joinBivariate, bivariatePaletteColors } from "../lib/bivariate";
import { spikeTriangles } from "../lib/spike";
import { hexbin } from "../lib/hexbin";
import { nonContiguousCartogram, dorlingCartogram } from "../lib/cartogram";
import { buildFlows } from "../lib/flow";
import { featureCentroid } from "../lib/centroid";
import { templateColumns } from "../lib/tooltip";
import { buildClassVisibilityFilter, classLabel } from "../lib/class-filter";
import { rowsForFrame, frameLabel } from "../lib/temporal";
import { buildDataLayer } from "../lib/data-layer";

const NO_DATA_COLOR = DEFAULT_NO_DATA_COLOR;
/** Categorical palette for point/category colouring (falls back to teal). */
const CAT_PALETTE =
  COLOR_SCALES.find((s) => s.id === "cat")?.colors ?? [BRAND_TEAL];

/** "Label (unit)" if a unit is set, otherwise just the label. */
function labelWithUnit(label: string, unit?: string): string {
  const u = (unit ?? "").trim();
  return u ? `${label} (${u})` : label;
}

export function MapCanvas() {
  const {
    project,
    brand,
    vizType,
    design,
    data,
    exportNodeRef,
    timeIndex,
    setTimeIndex,
    annotations,
    annotationTool,
    addAnnotation,
    setAnnotationTool,
    mapApiRef,
  } = useStudio();
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
  // (bubble size), the spike map (centroid heights) and the 3D extrusion.
  // Same join, several renderings.
  const joined = useMemo(() => {
    if (!data || data.kind !== "area" || !rawGeo) return null;
    if (
      vizType !== "choropleth" &&
      vizType !== "symbol" &&
      vizType !== "spike" &&
      vizType !== "extrusion" &&
      vizType !== "cartogram"
    )
      return null;
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

  // Bivariate map (O4): join two value columns onto the geometry → class 0..8.
  const bivariate = useMemo(() => {
    if (vizType !== "bivariate" || !rawGeo || data?.kind !== "area") return null;
    const colB =
      design.bivariateColumn2 && data.numericColumns.includes(design.bivariateColumn2)
        ? design.bivariateColumn2
        : data.numericColumns.find((c) => c !== data.valueColumn) ?? "";
    if (!colB || !data.valueColumn) return null;
    return joinBivariate({
      geojson: rawGeo,
      level: data.geoLevel,
      rows: data.rows,
      keyColumn: data.keyColumn,
      columnA: data.valueColumn,
      columnB: colB,
    });
  }, [vizType, rawGeo, data, design.bivariateColumn2]);

  // Spike map (O4): a triangle at each area's centroid, height ∝ value.
  const spike = useMemo(() => {
    if (vizType !== "spike" || !joined || data?.kind !== "area") return null;
    const nameField = GEO_LEVELS[data.geoLevel].nameField;
    const inputs: { lng: number; lat: number; value: number; name?: string }[] = [];
    let max = -Infinity;
    for (const f of joined.geojson.features) {
      const v = (f.properties as Record<string, unknown>)?.__value;
      if (typeof v !== "number") continue;
      const c = featureCentroid(f.geometry);
      if (!c) continue;
      if (v > max) max = v;
      const name = (f.properties as Record<string, unknown>)?.[nameField];
      inputs.push({ lng: c[0], lat: c[1], value: v, name: name ? String(name) : undefined });
    }
    if (inputs.length === 0) return null;
    return spikeTriangles(inputs, { maxValue: max });
  }, [vizType, joined, data]);

  // Hexbin map (O4): aggregate the point cloud into a hex-grid density surface.
  const hexbinResult = useMemo(() => {
    if (vizType !== "hexbin" || data?.kind !== "point" || !points) return null;
    const pts = points.geojson.features
      .map((f) => {
        const g = f.geometry;
        return g.type === "Point"
          ? { lng: g.coordinates[0], lat: g.coordinates[1] }
          : null;
      })
      .filter((p): p is { lng: number; lat: number } => p != null);
    if (pts.length === 0) return null;
    return hexbin(pts, { targetCols: 22 });
  }, [vizType, data, points]);

  // Hexbin class breaks (shared by the fill expression and the legend).
  const hexbinClasses = useMemo(() => {
    if (vizType !== "hexbin" || !hexbinResult) return null;
    return computeBreaks(
      hexbinResult.counts,
      design.classification,
      design.nClasses,
      design.manualBreaks,
    );
  }, [vizType, hexbinResult, design.classification, design.nClasses, design.manualBreaks]);

  // Cartogram (O4): deform the area geometry by value. Non-contiguous scales
  // each area around its centroid; Dorling replaces areas with sized circles.
  const cartogram = useMemo(() => {
    if (vizType !== "cartogram" || !joined || data?.kind !== "area") return null;
    if (design.cartogramKind === "dorling") {
      const nameField = GEO_LEVELS[data.geoLevel].nameField;
      const inputs: { lng: number; lat: number; value: number; name?: string }[] = [];
      for (const f of joined.geojson.features) {
        const v = (f.properties as Record<string, unknown>)?.__value;
        if (typeof v !== "number") continue;
        const c = featureCentroid(f.geometry);
        if (!c) continue;
        const nm = (f.properties as Record<string, unknown>)?.[nameField];
        inputs.push({ lng: c[0], lat: c[1], value: v, name: nm ? String(nm) : undefined });
      }
      return dorlingCartogram(inputs);
    }
    return nonContiguousCartogram(joined.geojson.features);
  }, [vizType, joined, data, design.cartogramKind]);

  // Flow map (O4): arcs between origin/destination coordinate columns.
  const flow = useMemo(() => {
    if (vizType !== "flow" || !data) return null;
    const { flowFromLat, flowFromLon, flowToLat, flowToLon, flowValue } = design;
    if (!flowFromLat || !flowFromLon || !flowToLat || !flowToLon) return null;
    return buildFlows(data.rows, {
      fromLat: flowFromLat,
      fromLon: flowFromLon,
      toLat: flowToLat,
      toLon: flowToLon,
      value: flowValue || undefined,
    });
  }, [vizType, data, design.flowFromLat, design.flowFromLon, design.flowToLat, design.flowToLon, design.flowValue]);

  const valueLabel =
    (design.valueLabel ||
      (data && data.kind !== "table" ? data.valueColumn : "")) ??
    "";

  // Bivariate: the selected 3×3 palette and the per-axis labels (with units).
  const bivPalette = bivariatePaletteColors(design.bivariatePalette);
  const bivColB =
    data?.kind === "area"
      ? design.bivariateColumn2 && data.numericColumns.includes(design.bivariateColumn2)
        ? design.bivariateColumn2
        : data.numericColumns.find((c) => c !== data.valueColumn) ?? ""
      : "";
  const bivLabelA = labelWithUnit(
    design.valueLabel || (data?.kind === "area" ? data.valueColumn : "") || "Variabile 1",
    design.valueUnit,
  );
  const bivLabelB = labelWithUnit(
    design.valueLabel2 || bivColB || "Variabile 2",
    design.valueUnit2,
  );

  const dataLayer: DataLayer | null = useMemo(
    () =>
      buildDataLayer({
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
      }),
    [vizType, joined, choro, symbolPoints, categoryJoin, points, geoRender, bivariate, spike, hexbinResult, hexbinClasses, cartogram, flow, scaleColors, data, valueLabel, design],
  );

  // Tilt the camera for the 3D extrusion; flat for every other map.
  const pitch = vizType === "extrusion" ? 50 : 0;

  // The class breaks the value legend should display, by map type. Choropleth,
  // hexbin, 3D extrusion and globe all colour areas by graduated classes, so they
  // share the same steps/gradient legend; the others use their own legend
  // (bivariate matrix, heatmap density, spike range) or none.
  const legendClasses =
    vizType === "choropleth"
      ? choro?.classes ?? null
      : vizType === "extrusion"
        ? joined?.classes ?? null
        : vizType === "cartogram"
          ? joined?.classes ?? null
          : vizType === "hexbin"
            ? hexbinClasses
            : null;
  // Count of "no data" areas to note under the legend (graduated area maps).
  const legendNoData =
    vizType === "choropleth"
      ? choro?.noDataFeatures ?? 0
      : vizType === "extrusion"
        ? joined?.noDataFeatures ?? 0
        : 0;
  const showLegend = design.showLegend && legendClasses != null;

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
  // a satellite/WMS basemap resolves to a raster style object; "none"/"custom"
  // → no basemap (transparent background).
  const basemapStyle = resolveBasemap(design.basemap, design.customBasemapUrl);
  const hasBasemap = Boolean(basemapStyle);

  const legendColors = legendClasses
    ? sampleColors(scaleColors, legendClasses.breaks.length + 1)
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
        basemapUrl={basemapStyle}
        hideLabels={design.hideLabels}
        dataFilter={dataFilter}
        pitch={pitch}
        globe={design.globe}
        dataOpacity={design.dataOpacity ?? 1}
        onMapReady={(api) => {
          mapApiRef.current = api;
        }}
        annotations={annotations}
        annotationTool={annotationTool}
        onPlaceAnnotation={addAnnotation}
        onExitTool={() => setAnnotationTool(null)}
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
              {project.title || "Untitled map"}
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
              <span>{legendClasses ? formatNum(legendClasses.min, design.valueUnit) : "min"}</span>
              <span>{legendClasses ? formatNum(legendClasses.max, design.valueUnit) : "max"}</span>
            </div>
            {legendNoData > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-400">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: NO_DATA_COLOR }}
                />
                Dato non disponibile ({legendNoData})
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bivariate legend (bottom-left): a 3×3 colour matrix with axis labels. */}
      {design.showLegend && vizType === "bivariate" && bivariate && (
        <div className="pointer-events-none absolute bottom-8 left-4">
          <div className="rounded-lg bg-white/92 px-3 py-2.5 shadow-md ring-1 ring-black/5 backdrop-blur">
            <div className="flex items-end gap-1.5">
              {/* Vertical axis label (variable B), rotated. */}
              <span className="mb-3 text-[9px] font-medium uppercase tracking-wide text-slate-500 [writing-mode:vertical-rl] rotate-180">
                {bivLabelB} →
              </span>
              <div>
                <div className="grid grid-cols-3 grid-rows-3 gap-0.5">
                  {/* Render rows top (B high, row 2) to bottom (B low, row 0). */}
                  {[2, 1, 0].map((r) =>
                    [0, 1, 2].map((c) => (
                      <span
                        key={`${r}-${c}`}
                        className="h-4 w-4"
                        style={{ background: bivPalette[r * 3 + c] }}
                      />
                    )),
                  )}
                </div>
                <span className="mt-0.5 block text-[9px] font-medium uppercase tracking-wide text-slate-500">
                  {bivLabelA} →
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Heatmap density legend (bottom-left): a low→high colour ramp. */}
      {design.showLegend && vizType === "heatmap" && (
        <div className="pointer-events-none absolute bottom-8 left-4">
          <div className="rounded-lg bg-white/92 px-3 py-2 shadow-md ring-1 ring-black/5 backdrop-blur">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {valueLabel || "Densità"}
            </p>
            <div
              className="h-2.5 w-40 rounded-full"
              style={{
                background: `linear-gradient(to right, transparent, ${scaleColors.join(", ")})`,
              }}
            />
            <div className="mt-1 flex justify-between text-[10px] text-slate-500">
              <span>meno</span>
              <span>più</span>
            </div>
          </div>
        </div>
      )}

      {/* Spike legend (bottom-left): height is proportional to the value. */}
      {design.showLegend && vizType === "spike" && joined && (
        <div className="pointer-events-none absolute bottom-8 left-4">
          <div className="rounded-lg bg-white/92 px-3 py-2 shadow-md ring-1 ring-black/5 backdrop-blur">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {valueLabel || "Valore"}
            </p>
            <div className="flex items-end gap-2">
              <span
                className="inline-block w-0 border-x-[5px] border-x-transparent border-b-[10px]"
                style={{ borderBottomColor: design.pointColor }}
              />
              <span
                className="inline-block w-0 border-x-[5px] border-x-transparent border-b-[24px]"
                style={{ borderBottomColor: design.pointColor }}
              />
              <span className="text-[10px] text-slate-500">altezza ∝ valore</span>
            </div>
            <div className="mt-1 flex w-28 justify-between text-[10px] text-slate-500">
              <span>{formatNum(joined.classes.min, design.valueUnit)}</span>
              <span>{formatNum(joined.classes.max, design.valueUnit)}</span>
            </div>
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

