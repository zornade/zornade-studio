import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Flavor } from "@protomaps/basemaps";
import { buildStyle } from "../basemap";
import { ensurePmtilesProtocol } from "../lib/pmtiles";
import { renderTooltipTemplate, tooltipValues } from "../lib/tooltip";
import { computeBounds } from "../lib/geo-bounds";
import { skySpec, lightSpec, projectionSpec } from "../lib/map-style";
import { BRAND_TEAL } from "../studio/palettes";
import {
  annotationsToGeoJson,
  markerAnnotations,
  newAnnotationId,
  makeMarker,
  makeText,
  makeLine,
  makeArea,
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_LINE_WIDTH,
  DEFAULT_AREA_OPACITY,
  type Annotation,
  type DrawTool,
  type LngLat,
  type MarkerDescriptor,
} from "../lib/annotations";
import type { StoryCamera } from "../lib/story";

/** A choropleth data layer to overlay on the basemap. */
export interface DataLayer {
  geojson: GeoJSON.FeatureCollection;
  /**
   * "area" → fill+line choropleth (default); "point" → circle layer;
   * "geo" → the user's own geometry (polygons/lines/points drawn together);
   * "heatmap" → density surface from points; "extrusion" → 3D fill-extrusion.
   */
  kind?: "area" | "point" | "geo" | "heatmap" | "extrusion";
  /** MapLibre paint expression for `fill-color` (area / geo polygons). */
  fillColor?: unknown;
  /** Outline colour for the polygons (area). */
  lineColor?: string;
  /** MapLibre paint expression/colour for `line-color` (geo lines). */
  lineColorExpr?: unknown;
  /** MapLibre paint expression/colour for `circle-color` (point / geo points). */
  circleColor?: unknown;
  /** MapLibre paint expression/number for `circle-radius` (point / geo points). */
  circleRadius?: unknown;
  /** Circle fill opacity (point). Default 0.9. */
  circleOpacity?: number;
  /** Heatmap paint object (kind "heatmap"). */
  heatmapPaint?: Record<string, unknown>;
  /** Value range driving the extrusion height (kind "extrusion"). */
  extrusionRange?: { min: number; max: number };
  /** Max extrusion height in metres (kind "extrusion"). Default 180000. */
  extrusionMaxHeight?: number;
  /** Feature property holding the area name (for tooltips). */
  nameField?: string;
  /** Show always-on text labels from `nameField` (locator map). */
  showLabels?: boolean;
  /** Human label for the mapped value (for tooltips). */
  valueLabel?: string;
  /** Optional unit appended to the value (for tooltips). */
  valueUnit?: string;
  /** Custom tooltip HTML template ({nome},{valore},{colonna}); "" = default. */
  tooltipTemplate?: string;
}

interface MapPreviewProps {
  tilesUrl: string;
  flavor: Flavor;
  /** BCP-47 label language. Default "it". */
  lang?: string;
  /** Optional choropleth overlay. */
  dataLayer?: DataLayer | null;
  /** Show a tooltip with name + value on hover. Default true. */
  tooltip?: boolean;
  /** Allow zoom & pan interactions. Default true. */
  zoomPan?: boolean;
  /** Render the basemap. When false, the background is transparent. Default true. */
  basemap?: boolean;
  /**
   * External MapLibre basemap: a style URL (e.g. OpenFreeMap) or a raster style
   * object (satellite/WMS). When set, it takes priority over the bundled
   * Protomaps/PMTiles style and the data is overlaid on top of it.
   */
  basemapUrl?: string | maplibregl.StyleSpecification | null;
  /**
   * Changing this string triggers an auto fit-bounds to the data extent.
   * Keep it stable across basemap/style changes so the camera is only refit
   * when the underlying dataset changes (not on every restyle).
   */
  fitKey?: string | null;
  /**
   * MapLibre filter expression applied to the data layer(s) for reader-facing
   * class filtering. `null` clears any filter (all features shown).
   */
  dataFilter?: unknown | null;
  /** Custom annotations to render over the map (O3.4). */
  annotations?: Annotation[];
  /** Armed drawing tool: clicks on the map place an annotation. */
  annotationTool?: DrawTool | null;
  /** Called when a placement completes with the new annotation. */
  onPlaceAnnotation?: (a: Annotation) => void;
  /** Called to disarm the tool (Escape, or after a one-shot placement). */
  onExitTool?: () => void;
  /** Map pitch in degrees (e.g. for 3D extrusion). Default 0. */
  pitch?: number;
  /** Switch to spherical globe projection. Default false. */
  globe?: boolean;
  /** Receives the imperative camera API (for scrollytelling authoring). */
  onMapReady?: (api: {
    getCamera: () => StoryCamera;
    flyTo: (c: StoryCamera) => void;
  }) => void;
}

// Centred on the Italian peninsula.
const INITIAL_CENTER: [number, number] = [12.5, 42.5];
const INITIAL_ZOOM = 5;

const SRC = "studio-data";
const FILL = "studio-data-fill";
const LINE = "studio-data-line";
/** Always-on point labels (locator map). */
const LABEL = "studio-data-label";
/** Density heatmap layer (heatmap map). */
const HEATMAP = "studio-data-heatmap";
/** 3D extrusion layer (extrusion map). */
const EXTRUSION = "studio-data-extrusion";
/** Extra layer for points inside a user "geo" dataset (KML/Shapefile points). */
const GEO_POINT = "studio-geo-point";

/** Annotation layers (O3.4): lines/areas as GeoJSON, drawn above the data. */
const ANNOT_SRC = "studio-annot";
const ANNOT_FILL = "studio-annot-fill";
const ANNOT_LINE = "studio-annot-line";
const ANNOT_PREVIEW_SRC = "studio-annot-preview";
const ANNOT_PREVIEW_FILL = "studio-annot-preview-fill";
const ANNOT_PREVIEW_LINE = "studio-annot-preview-line";
const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Italian number formatting for tooltip values. */
const fmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

/** Layer ids this component manages; never treat them as basemap geometry. */
const OWN_LAYER_IDS = new Set<string>([
  FILL,
  LINE,
  LABEL,
  HEATMAP,
  EXTRUSION,
  GEO_POINT,
  ANNOT_FILL,
  ANNOT_LINE,
  ANNOT_PREVIEW_FILL,
  ANNOT_PREVIEW_LINE,
]);

/**
 * Insertion point (`before` id) for the data layers: above every basemap
 * geometry layer (roads, buildings, boundaries) but below the first label.
 *
 * The naive "first symbol layer" heuristic is wrong for OpenMapTiles styles
 * (OpenFreeMap), where an early `water_name` symbol precedes the road/building
 * layers — inserting before it buries the data UNDER the roads. Instead we find
 * the last basemap fill/line/extrusion layer and return the id of the next
 * (label) layer. Returns undefined when no label follows → add on top.
 */
function dataInsertBeforeId(map: maplibregl.Map): string | undefined {
  const ls = map.getStyle().layers ?? [];
  let lastGeom = -1;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (OWN_LAYER_IDS.has(l.id)) continue;
    if (
      l.type === "fill" ||
      l.type === "line" ||
      l.type === "fill-extrusion" ||
      l.type === "raster"
    ) {
      lastGeom = i;
    }
  }
  for (let i = lastGeom + 1; i < ls.length; i++) {
    if (!OWN_LAYER_IDS.has(ls[i].id)) return ls[i].id;
  }
  return undefined;
}

/**
 * Move every basemap label (symbol) layer above the data layers so place names
 * stay readable on top of the overlay. 2D renders only — callers skip the 3D
 * extrusion path. Mirrors the embed's `raiseLabels`. Annotations (the topmost
 * overlay) are kept above the labels by anchoring them just below the first
 * annotation layer, since syncData can run without re-syncing annotations.
 */
function raiseBasemapLabels(map: maplibregl.Map): void {
  const layers = map.getStyle().layers ?? [];
  const annotAnchor = layers.find(
    (l) =>
      l.id === ANNOT_FILL ||
      l.id === ANNOT_LINE ||
      l.id === ANNOT_PREVIEW_FILL ||
      l.id === ANNOT_PREVIEW_LINE,
  )?.id;
  for (const l of layers) {
    if (l.type === "symbol" && !OWN_LAYER_IDS.has(l.id)) {
      try {
        map.moveLayer(l.id, annotAnchor);
      } catch {
        /* layer removed during a concurrent restyle — ignore. */
      }
    }
  }
}

/**
 * Add a subtle sky + atmospheric haze. On a pitched 2D map it draws a soft
 * horizon; on the globe it gives the planet a blue atmosphere halo. The
 * atmosphere fades out as the camera zooms in so it never washes out the data.
 * setStyle() wipes the sky, so this is re-applied after every (re)style.
 */
function applySky(map: maplibregl.Map, globe: boolean): void {
  try {
    map.setSky(skySpec(globe));
  } catch {
    /* setSky unsupported by the current renderer — ignore. */
  }
}

/**
 * Directional lighting for the 3D extrusion. A light anchored to the map (so
 * the shading stays consistent with the geography as the camera rotates),
 * coming from the upper-left at a moderate elevation, shades the sides of the
 * extruded shapes and gives them real volume instead of a flat colour. Harmless
 * for the flat maps (only `fill-extrusion` layers react to it). Wiped by
 * setStyle(), so it is re-applied wherever applySky is.
 */
function applyLight(map: maplibregl.Map): void {
  try {
    map.setLight(lightSpec());
  } catch {
    /* setLight unsupported by the current renderer — ignore. */
  }
}

/**
 * Apply the map projection (globe vs flat mercator). setStyle() resets the
 * projection to the style's default (mercator), so this MUST be re-applied
 * after every (re)style — otherwise the globe silently reverts to flat when the
 * user changes basemap, language or font while the globe toggle is still on.
 * setProjection throws on a renderer without globe support (pre-v5), so guard it.
 */
function applyProjection(map: maplibregl.Map, globe: boolean): void {
  try {
    map.setProjection(projectionSpec(globe));
  } catch {
    /* globe projection unsupported by the current renderer — ignore. */
  }
}

/**
 * Force every place/road label to Italian. The bundled Protomaps style is
 * already built with `lang: "it"`, but the external OpenFreeMap basemaps
 * (Positron/Bright/Liberty/Dark, OpenMapTiles schema) ship `text-field`
 * expressions that render the local/native name (or a latin transliteration),
 * so e.g. "München", "Wien", "London" show instead of "Monaco", "Vienna",
 * "Londra". We rewrite the `text-field` of every symbol layer that renders a
 * name to prefer `name:it`, falling back to the latin name and finally the raw
 * `name`. Idempotent and schema-agnostic (both Protomaps and OpenMapTiles tiles
 * carry `name:it` + `name`). setStyle() wipes this, so re-apply after each
 * (re)style, like applySky/applyLight.
 */
function localizeLabels(map: maplibregl.Map, lang = "it"): void {
  let style: maplibregl.StyleSpecification | undefined;
  try {
    style = map.getStyle();
  } catch {
    return; // style not ready yet
  }
  if (!style?.layers) return;
  const localized: maplibregl.ExpressionSpecification = [
    "coalesce",
    ["get", `name:${lang}`],
    ["get", "name:latin"],
    ["get", "name"],
  ];
  for (const layer of style.layers) {
    if (layer.type !== "symbol") continue;
    const tf = (layer.layout as { "text-field"?: unknown } | undefined)?.["text-field"];
    if (tf === undefined) continue;
    // Only touch layers that render a name (skip housenumber, ref, ele, …).
    if (!JSON.stringify(tf).includes('"name')) continue;
    try {
      map.setLayoutProperty(layer.id, "text-field", localized);
    } catch {
      /* layer removed mid-restyle — ignore. */
    }
  }
}

export function MapPreview({
  tilesUrl,
  flavor,
  lang = "it",
  dataLayer = null,
  tooltip = true,
  zoomPan = true,
  basemap = true,
  basemapUrl = null,
  fitKey = null,
  dataFilter = null,
  annotations = [],
  annotationTool = null,
  onPlaceAnnotation,
  onExitTool,
  pitch = 0,
  globe = false,
  onMapReady,
}: MapPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const dataLayerRef = useRef<DataLayer | null>(dataLayer);
  dataLayerRef.current = dataLayer;
  const dataFilterRef = useRef<unknown | null>(dataFilter);
  dataFilterRef.current = dataFilter;
  const navControlRef = useRef<maplibregl.NavigationControl | null>(null);
  /** Cursor-following DOM tooltip (screen-space; robust on pitch/globe). */
  const tipRef = useRef<HTMLDivElement | null>(null);
  const tooltipEnabledRef = useRef<boolean>(tooltip);
  tooltipEnabledRef.current = tooltip;
  const lastFitRef = useRef<string | null>(null);
  /** Live globe flag read by the once-bound load/restyle handlers (for sky). */
  const globeRef = useRef<boolean>(globe);
  globeRef.current = globe;
  /** Feature id currently under the cursor (for the hover highlight). */
  const hoveredIdRef = useRef<number | string | null>(null);
  /** Imperative hide for the cursor tooltip, set once the map is built. */
  const tipHideRef = useRef<(() => void) | null>(null);

  // --- Annotations (O3.4): live refs read by the once-bound map handlers. ---
  const annotationsRef = useRef<Annotation[]>(annotations);
  annotationsRef.current = annotations;
  const annotToolRef = useRef<DrawTool | null>(annotationTool);
  annotToolRef.current = annotationTool;
  const onPlaceRef = useRef(onPlaceAnnotation);
  onPlaceRef.current = onPlaceAnnotation;
  const onExitRef = useRef(onExitTool);
  onExitRef.current = onExitTool;
  const onMapRef = useRef(onMapReady);
  onMapRef.current = onMapReady;
  /** DOM markers currently on the map (marker + text annotations). */
  const markerObjsRef = useRef<maplibregl.Marker[]>([]);
  /** First click of a two-step (line/area) placement, or null. */
  const pendingRef = useRef<LngLat | null>(null);

  // Add/update/remove the choropleth source + layers. Re-runs after every
  // setStyle (which wipes custom layers), so it is idempotent.
  const syncData = (map: maplibregl.Map) => {
    if (!map.isStyleLoaded()) {
      map.once("idle", () => syncData(map));
      return;
    }
    if (map.getLayer(GEO_POINT)) map.removeLayer(GEO_POINT);
    if (map.getLayer(LABEL)) map.removeLayer(LABEL);
    if (map.getLayer(HEATMAP)) map.removeLayer(HEATMAP);
    if (map.getLayer(EXTRUSION)) map.removeLayer(EXTRUSION);
    if (map.getLayer(LINE)) map.removeLayer(LINE);
    if (map.getLayer(FILL)) map.removeLayer(FILL);
    if (map.getSource(SRC)) map.removeSource(SRC);

    const layer = dataLayerRef.current;
    if (!layer) return;

    map.addSource(SRC, { type: "geojson", data: layer.geojson, generateId: true });

    // Insert above all basemap geometry (roads, buildings, boundaries) but
    // below the first label, so place names stay readable and the basemap
    // roads never paint over the data (see dataInsertBeforeId).
    const firstSymbol = dataInsertBeforeId(map);

    if (layer.kind === "heatmap") {
      // Density heatmap from points (paint precomputed in lib/heatmap).
      map.addLayer(
        {
          id: HEATMAP,
          type: "heatmap",
          source: SRC,
          paint: (layer.heatmapPaint ?? {}) as maplibregl.HeatmapLayerSpecification["paint"],
        },
        firstSymbol,
      );
      raiseBasemapLabels(map);
      return;
    }

    if (layer.kind === "extrusion") {
      // 3D extrusion: height scaled from the value range; colour graduated like
      // the choropleth. Needs map pitch > 0 (set via the pitch prop) to be seen.
      const range = layer.extrusionRange ?? { min: 0, max: 1 };
      const maxH = layer.extrusionMaxHeight ?? 180000;
      // Floor the smallest bars to a fraction of the max height so low values
      // still rise visibly off the surface instead of sitting at height 0,
      // where they z-fight with the basemap (and intersect the 3D globe).
      const minH = Math.max(maxH * 0.04, 2000);
      map.addLayer({
        id: EXTRUSION,
        type: "fill-extrusion",
        source: SRC,
        paint: {
          "fill-extrusion-color":
            (layer.fillColor as maplibregl.ExpressionSpecification) ?? BRAND_TEAL,
          "fill-extrusion-height": [
            "interpolate",
            ["linear"],
            ["coalesce", ["get", "__value"], range.min],
            range.min,
            minH,
            range.max,
            maxH,
          ] as unknown as maplibregl.ExpressionSpecification,
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.95,
          "fill-extrusion-vertical-gradient": true,
        },
      });
      applyDataFilter(map);
      return;
    }

    if (layer.kind === "point") {
      // Point layer: a single circle layer keyed FILL so the existing hover
      // tooltip (bound to FILL) works for points too.
      map.addLayer(
        {
          id: FILL,
          type: "circle",
          source: SRC,
          paint: {
            "circle-color":
              (layer.circleColor as maplibregl.ExpressionSpecification) ??
              BRAND_TEAL,
            "circle-radius":
              (layer.circleRadius as maplibregl.ExpressionSpecification) ?? 5,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1,
            "circle-opacity": layer.circleOpacity ?? 0.9,
          },
        },
        firstSymbol,
      );
      // Locator: always-on text labels above the points. Reuse the basemap's
      // own glyph font (read from the first symbol layer) so the text is
      // guaranteed to render; fall back to a common font otherwise.
      if (layer.showLabels && layer.nameField) {
        let textFont: string[] = ["Noto Sans Regular"];
        if (firstSymbol) {
          const f = map.getLayoutProperty(firstSymbol, "text-font");
          if (Array.isArray(f) && f.length > 0) textFont = f as string[];
        }
        map.addLayer({
          id: LABEL,
          type: "symbol",
          source: SRC,
          layout: {
            "text-field": ["get", layer.nameField],
            "text-font": textFont,
            "text-size": 12,
            "text-anchor": "top",
            "text-offset": [0, 0.8],
            "text-max-width": 10,
          },
          paint: {
            "text-color": "#0f172a",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.4,
          },
        });
      }
      raiseBasemapLabels(map);
      return;
    }

    if (layer.kind === "geo") {
      // The user's own geometry. MapLibre applies a `fill` layer only to
      // polygons, a `line` layer to polygons (outline) + lines, and a `circle`
      // layer only to points — so one source with three layers renders mixed
      // collections correctly. Polygons are coloured by value/category (FILL,
      // which the tooltip is bound to); lines and points get their own colour.
      map.addLayer(
        {
          id: FILL,
          type: "fill",
          source: SRC,
          paint: {
            "fill-color":
              (layer.fillColor as maplibregl.ExpressionSpecification) ??
              BRAND_TEAL,
            "fill-opacity": 0.7,
          },
        },
        firstSymbol,
      );
      map.addLayer(
        {
          id: LINE,
          type: "line",
          source: SRC,
          paint: {
            "line-color":
              (layer.lineColorExpr as maplibregl.ExpressionSpecification) ??
              layer.lineColor ??
              BRAND_TEAL,
            "line-width": 1.2,
          },
        },
        firstSymbol,
      );
      map.addLayer(
        {
          id: GEO_POINT,
          type: "circle",
          source: SRC,
          paint: {
            "circle-color":
              (layer.circleColor as maplibregl.ExpressionSpecification) ??
              BRAND_TEAL,
            "circle-radius":
              (layer.circleRadius as maplibregl.ExpressionSpecification) ?? 5,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1,
            "circle-opacity": 0.9,
          },
        },
        firstSymbol,
      );
      applyDataFilter(map);
      raiseBasemapLabels(map);
      return;
    }

    map.addLayer(
      {
        id: FILL,
        type: "fill",
        source: SRC,
        paint: {
          "fill-color": layer.fillColor as maplibregl.ExpressionSpecification,
          // Brighten the polygon under the cursor (hover highlight); the rest
          // stays slightly translucent so the basemap gives a sense of depth.
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.95,
            0.82,
          ] as unknown as maplibregl.ExpressionSpecification,
        },
      },
      firstSymbol,
    );
    map.addLayer(
      {
        id: LINE,
        type: "line",
        source: SRC,
        paint: {
          "line-color": layer.lineColor ?? "#ffffff",
          // Thin white casing between polygons; thickens on hover.
          "line-width": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            1.6,
            0.6,
          ] as unknown as maplibregl.ExpressionSpecification,
          "line-opacity": 0.55,
        },
      },
      firstSymbol,
    );
    applyDataFilter(map);
    raiseBasemapLabels(map);
  };

  /** Apply the reader-facing class filter to the data layers (if present). */
  const applyDataFilter = (map: maplibregl.Map) => {
    const filter = (dataFilterRef.current ?? null) as
      | maplibregl.FilterSpecification
      | null;
    for (const id of [FILL, LINE]) {
      if (map.getLayer(id)) map.setFilter(id, filter);
    }
  };

  // --- Annotations (O3.4) ---------------------------------------------------
  // Render line/area annotations as a GeoJSON source + fill/line layers drawn
  // ABOVE the data, and marker/text annotations as DOM markers. Idempotent:
  // re-runs after every setStyle (which wipes custom layers), reusing the
  // source when it already exists so updates are cheap.
  const syncAnnotations = (map: maplibregl.Map) => {
    if (!map.isStyleLoaded()) {
      map.once("idle", () => syncAnnotations(map));
      return;
    }
    const fc = annotationsToGeoJson(annotationsRef.current);
    const src = map.getSource(ANNOT_SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(fc);
    } else {
      map.addSource(ANNOT_SRC, { type: "geojson", data: fc });
      map.addLayer({
        id: ANNOT_FILL,
        type: "fill",
        source: ANNOT_SRC,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": ["get", "__color"],
          "fill-opacity": ["get", "__opacity"],
        },
      });
      map.addLayer({
        id: ANNOT_LINE,
        type: "line",
        source: ANNOT_SRC,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "__color"],
          "line-width": ["get", "__width"],
        },
      });
    }
    syncAnnotationMarkers(map);
  };

  /** Rebuild the DOM markers for marker + text annotations (cheap; recreate). */
  const syncAnnotationMarkers = (map: maplibregl.Map) => {
    for (const m of markerObjsRef.current) m.remove();
    markerObjsRef.current = [];
    for (const desc of markerAnnotations(annotationsRef.current)) {
      const marker = new maplibregl.Marker({
        element: buildMarkerEl(desc),
        anchor: desc.type === "marker" ? "bottom" : "center",
      })
        .setLngLat([desc.lng, desc.lat])
        .addTo(map);
      markerObjsRef.current.push(marker);
    }
  };

  /** Lazily add the dashed preview layers used during a two-step placement. */
  const ensurePreviewLayers = (map: maplibregl.Map) => {
    if (map.getSource(ANNOT_PREVIEW_SRC)) return;
    map.addSource(ANNOT_PREVIEW_SRC, { type: "geojson", data: EMPTY_FC });
    map.addLayer({
      id: ANNOT_PREVIEW_FILL,
      type: "fill",
      source: ANNOT_PREVIEW_SRC,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": ["get", "__color"],
        "fill-opacity": ["get", "__opacity"],
      },
    });
    map.addLayer({
      id: ANNOT_PREVIEW_LINE,
      type: "line",
      source: ANNOT_PREVIEW_SRC,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "__color"],
        "line-width": ["get", "__width"],
        "line-dasharray": [2, 1.5],
      },
    });
  };

  const setPreview = (map: maplibregl.Map, fc: GeoJSON.FeatureCollection) => {
    if (!map.isStyleLoaded()) return;
    ensurePreviewLayers(map);
    const s = map.getSource(ANNOT_PREVIEW_SRC) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (s) s.setData(fc);
  };

  const clearPreview = (map: maplibregl.Map) => setPreview(map, EMPTY_FC);

  // Resolve the MapLibre style: an external URL (OpenFreeMap) takes priority,
  // otherwise build the bundled Protomaps/PMTiles style.
  const resolveStyle = ():
    | string
    | maplibregl.StyleSpecification => {
    if (basemapUrl) return basemapUrl;
    const style = buildStyle({
      tilesUrl,
      flavor,
      lang,
      basemap,
    }) as maplibregl.StyleSpecification;
    return style;
  };

  // Initialise the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    ensurePmtilesProtocol();

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: resolveStyle(),
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: false,
      // Required so the WebGL canvas can be read back for PNG export (O1.5).
      // In MapLibre 5 this moved into canvasContextAttributes.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    const nav = new maplibregl.NavigationControl({ showCompass: false });
    navControlRef.current = nav;
    map.addControl(nav, "top-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
      }),
      "bottom-right",
    );

    // Hover tooltip: a cursor-following DOM element (NOT a geo-anchored popup).
    // A MapLibre Popup pins to a lng/lat ground point; with the map pitched (3D
    // extrusion) or on the globe, that ground point projects to a screen spot
    // far from the cursor — behind/below tall bars — so the tooltip drifts and
    // the auto-reanchoring makes it jump and flicker. A `<div>` positioned at
    // the mouse pixel (`e.point`) always sits next to the cursor, in 2D, 3D and
    // on the globe alike. Same look as the chart tooltip (`studio-chart-tip`).
    const showTip = (html: string, x: number, y: number) => {
      const tip = tipRef.current;
      if (!tip) return;
      tip.innerHTML = html;
      // Flip to the left of the cursor near the right edge to avoid overflow.
      const flip = x > map.getCanvas().clientWidth - 180;
      tip.style.left = `${flip ? x - 14 : x + 14}px`;
      tip.style.top = `${y + 14}px`;
      tip.style.transform = flip ? "translateX(-100%)" : "none";
      tip.style.opacity = "1";
    };
    const hideTip = () => {
      const tip = tipRef.current;
      if (tip) tip.style.opacity = "0";
    };
    tipHideRef.current = hideTip;

    // --- Hover tooltip ------------------------------------------------------
    // A SINGLE map-level mousemove drives the tooltip for every data layer
    // (choropleth fill, geo lines/points and the 3D extrusion). Per-layer
    // mouseenter/leave handlers flicker badly on a pitched/globe 3D view: the
    // cursor constantly crosses the gaps between extruded bars (and the sky
    // behind them), firing leave→enter in quick succession. Querying the
    // rendered features once per move — and hiding only when nothing is hit —
    // is stable both in 2D and on the globe.
    const HOVER_LAYERS = [EXTRUSION, FILL, LINE, GEO_POINT];

    const tooltipHtmlFor = (f: maplibregl.MapGeoJSONFeature): string => {
      const layer = dataLayerRef.current;
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const name = layer?.nameField ? props[layer.nameField] : undefined;
      const raw = props.__value;
      const unit = layer?.valueUnit ? `\u00a0${layer.valueUnit}` : "";
      const value =
        typeof raw === "number"
          ? `${fmt.format(raw)}${unit}`
          : raw != null
            ? `${String(raw)}${unit}`
            : "n/d";
      const label = layer?.valueLabel ?? "Valore";
      const tpl = layer?.tooltipTemplate?.trim();
      return tpl
        ? renderTooltipTemplate(tpl, tooltipValues(props, String(name ?? ""), value))
        : `<div class="studio-tooltip-name">${escapeHtml(String(name ?? ""))}</div>` +
          `<div class="studio-tooltip-value"><span>${escapeHtml(label)}</span> ${escapeHtml(value)}</div>`;
    };

    const clearHoverState = () => {
      if (hoveredIdRef.current != null) {
        map.setFeatureState({ source: SRC, id: hoveredIdRef.current }, { hover: false });
        hoveredIdRef.current = null;
      }
    };

    const hideTooltip = () => {
      map.getCanvas().style.cursor = "";
      clearHoverState();
      hideTip();
    };

    const onHoverMove = (e: maplibregl.MapMouseEvent) => {
      // Drawing an annotation owns the cursor: never tooltip while a tool is armed.
      if (annotToolRef.current) {
        hideTooltip();
        return;
      }
      if (!tooltipEnabledRef.current) {
        hideTooltip();
        return;
      }
      const layers = HOVER_LAYERS.filter((id) => map.getLayer(id));
      const f = layers.length
        ? map.queryRenderedFeatures(e.point, { layers })[0]
        : undefined;
      if (!f) {
        hideTooltip();
        return;
      }
      map.getCanvas().style.cursor = "pointer";
      // Hover highlight: move the `hover` feature-state to the feature under the
      // cursor (read by the choropleth fill-opacity / line-width expressions;
      // a no-op for the other layers). Keyed by the source feature id, which is
      // shared across FILL/LINE/EXTRUSION for the same polygon.
      if (f.id !== hoveredIdRef.current) {
        clearHoverState();
        if (f.id != null) {
          hoveredIdRef.current = f.id;
          map.setFeatureState({ source: SRC, id: f.id }, { hover: true });
        }
      }
      showTip(tooltipHtmlFor(f), e.point.x, e.point.y);
    };

    map.on("mousemove", onHoverMove);
    // Hide when the pointer leaves the map canvas entirely.
    map.on("mouseout", hideTooltip);

    // Annotation placement: a click with a tool armed adds the annotation.
    // marker/text are one-shot single clicks; line/area take two clicks (a
    // start, then the end) with a dashed live preview between them.
    const handleAnnotClick = (e: maplibregl.MapMouseEvent) => {
      const tool = annotToolRef.current;
      if (!tool) return;
      const pt: LngLat = [e.lngLat.lng, e.lngLat.lat];
      const id = newAnnotationId();
      const col = DEFAULT_ANNOTATION_COLOR;
      if (tool.kind === "marker") {
        onPlaceRef.current?.(makeMarker(id, pt[0], pt[1], col, ""));
        onExitRef.current?.();
        return;
      }
      if (tool.kind === "text") {
        onPlaceRef.current?.(makeText(id, pt[0], pt[1], col, "Testo"));
        onExitRef.current?.();
        return;
      }
      const start = pendingRef.current;
      if (!start) {
        pendingRef.current = pt;
        return;
      }
      if (tool.kind === "line") {
        onPlaceRef.current?.(
          makeLine(id, start, pt, col, DEFAULT_LINE_WIDTH, tool.arrow),
        );
      } else {
        onPlaceRef.current?.(
          makeArea(id, tool.shape, start, pt, col, DEFAULT_AREA_OPACITY),
        );
      }
      pendingRef.current = null;
      clearPreview(map);
      onExitRef.current?.();
    };
    const handleAnnotMove = (e: maplibregl.MapMouseEvent) => {
      const tool = annotToolRef.current;
      const start = pendingRef.current;
      if (!tool || !start) return;
      const pt: LngLat = [e.lngLat.lng, e.lngLat.lat];
      const col = DEFAULT_ANNOTATION_COLOR;
      const temp =
        tool.kind === "line"
          ? makeLine("preview", start, pt, col, DEFAULT_LINE_WIDTH, tool.arrow)
          : tool.kind === "area"
            ? makeArea("preview", tool.shape, start, pt, col, DEFAULT_AREA_OPACITY)
            : null;
      if (temp) setPreview(map, annotationsToGeoJson([temp]));
    };
    map.on("click", handleAnnotClick);
    map.on("mousemove", handleAnnotMove);

    map.on("load", () => {
      applyProjection(map, globeRef.current);
      applySky(map, globeRef.current);
      applyLight(map);
      localizeLabels(map, lang);
      syncData(map);
      syncAnnotations(map);
    });
    mapRef.current = map;

    // Expose the imperative camera API for scrollytelling authoring (capture
    // the current view as a step, fly to a step's camera).
    onMapRef.current?.({
      getCamera: () => {
        const c = map.getCenter();
        const b = map.getBounds();
        return {
          center: [c.lng, c.lat] as [number, number],
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
          bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] as [number, number, number, number],
        };
      },
      flyTo: (cam) =>
        map.flyTo({
          center: cam.center,
          zoom: cam.zoom,
          pitch: cam.pitch,
          bearing: cam.bearing,
          duration: 1200,
        }),
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; style updates are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-apply the style whenever the flavor, tiles URL, language, label font or
  // external basemap URL changes. MapLibre preserves the camera across setStyle.
  //
  // setStyle() loads asynchronously (especially an external style URL) and
  // wipes custom sources/layers. We must wait for the NEW style to finish
  // loading before re-adding the choropleth — calling syncData synchronously
  // would add layers while the old style is still reported as loaded, and they
  // would then be removed when the new style takes over (the data "disappears"
  // when switching basemap). The "idle" event fires once the new style is
  // loaded and rendered, so it is the safe point to re-sync.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(resolveStyle());
    map.once("idle", () => {
      if (mapRef.current) {
        applyProjection(map, globeRef.current);
        applySky(map, globeRef.current);
        applyLight(map);
        localizeLabels(map, lang);
        syncData(map);
        syncAnnotations(map);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilesUrl, flavor, lang, basemap, basemapUrl]);

  // Re-sync the overlay whenever the data layer changes.
  useEffect(() => {
    const map = mapRef.current;
    if (map) syncData(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLayer]);

  // Tilt the camera for 3D extrusion (and flatten back for the other maps).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // On the globe, entering 3D extrusion re-frames the data with the tilt (the
    // same as the globe-toggle path) so the bars are not lost in the whole-world
    // view; on the flat map a plain pitch ease is enough.
    if (globeRef.current && pitch > 0 && dataLayer) {
      const bounds = computeBounds(dataLayer.geojson);
      if (bounds) {
        map.fitBounds(bounds, { padding: 48, maxZoom: 9, pitch, duration: 500 });
        return;
      }
    }
    if (Math.abs(map.getPitch() - pitch) > 0.5) {
      map.easeTo({ pitch, duration: 500 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitch]);

  // Switch between mercator and globe projection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      applyProjection(map, globe);
      applySky(map, globe);
      applyLight(map);
      if (globe) {
        // For a tilted 3D extrusion, frame the data with the tilt (like the
        // published embed) instead of zooming out to the whole planet: at the
        // whole-world zoom the extruded bars shrink to specks and the tilt
        // reads as broken. The pitch must be passed explicitly — fitBounds /
        // easeTo only carry the camera fields you give them, so without it the
        // globe transition would drop the tilt. For flat globe maps (pitch 0)
        // keep the classic whole-planet view centred on [0, 20].
        const bounds =
          pitch > 0 && dataLayer ? computeBounds(dataLayer.geojson) : null;
        if (bounds) {
          map.fitBounds(bounds, { padding: 48, maxZoom: 9, pitch, duration: 600 });
        } else {
          map.easeTo({ zoom: 1.5, center: [0, 20], pitch, duration: 400 });
        }
      }
      // Re-sync data layers after projection change so they are visible on the globe.
      syncData(map);
    };
    // setProjection requires the style to be fully loaded.
    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once("style.load", apply);
    }
  }, [globe]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-apply the reader class filter when it changes (without rebuilding data).
  useEffect(() => {
    const map = mapRef.current;
    if (map) applyDataFilter(map);
     
  }, [dataFilter]);

  // Re-render annotations whenever they change (O3.4).
  useEffect(() => {
    const map = mapRef.current;
    if (map) syncAnnotations(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations]);

  // Reflect the armed tool: a crosshair cursor while drawing; reset the pending
  // first-click and any preview when the tool is cleared.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = annotationTool ? "crosshair" : "";
    if (!annotationTool) {
      pendingRef.current = null;
      clearPreview(map);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotationTool]);

  // Escape cancels an in-progress placement and disarms the tool.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && annotToolRef.current) {
        pendingRef.current = null;
        const map = mapRef.current;
        if (map) clearPreview(map);
        onExitRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto fit-bounds to the data extent when the dataset changes (fitKey).
  // Guarded by lastFitRef so restyling (basemap change) does not refit and
  // override the user's manual zoom.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !dataLayer || !fitKey) return;
    if (lastFitRef.current === fitKey) return;
    const bounds = computeBounds(dataLayer.geojson);
    if (!bounds) return;
    const doFit = () =>
      map.fitBounds(bounds, { padding: 48, duration: 600, maxZoom: 9 });
    if (map.isStyleLoaded()) doFit();
    else map.once("idle", doFit);
    lastFitRef.current = fitKey;
     
  }, [fitKey, dataLayer]);

  // Enable/disable zoom & pan interactions and the navigation control.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handlers = [
      map.scrollZoom,
      map.boxZoom,
      map.dragPan,
      map.keyboard,
      map.doubleClickZoom,
      map.touchZoomRotate,
    ];
    if (zoomPan) {
      handlers.forEach((h) => h.enable());
      if (navControlRef.current && !map.hasControl(navControlRef.current)) {
        map.addControl(navControlRef.current, "top-right");
      }
    } else {
      handlers.forEach((h) => h.disable());
      if (navControlRef.current && map.hasControl(navControlRef.current)) {
        map.removeControl(navControlRef.current);
      }
    }
  }, [zoomPan]);

  // Hide the tooltip immediately when it is turned off.
  useEffect(() => {
    if (!tooltip) tipHideRef.current?.();
  }, [tooltip]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div ref={tipRef} className="studio-chart-tip" style={{ opacity: 0 }} />
    </div>
  );
}

/** Minimal HTML escaping for tooltip content. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A coloured teardrop map-pin SVG (tip at the bottom centre). */
function pinSvg(color: string): string {
  return (
    `<svg width="24" height="34" viewBox="0 0 24 34" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">` +
    `<path d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 22 12 22s12-13.6 12-22C24 5.4 18.6 0 12 0z" ` +
    `fill="${escapeHtml(color)}" stroke="#fff" stroke-width="2"/>` +
    `<circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>`
  );
}

/**
 * Build the DOM element for a marker / text annotation. A marker is a coloured
 * pin (anchored at its tip) with an optional label pill above it; a text
 * annotation is a coloured label box (anchored at its centre). Both ignore
 * pointer events so they never block map interaction.
 */
function buildMarkerEl(desc: MarkerDescriptor): HTMLElement {
  const el = document.createElement("div");
  el.style.pointerEvents = "none";
  if (desc.type === "marker") {
    el.style.position = "relative";
    const label = desc.text
      ? `<div style="position:absolute;bottom:38px;left:50%;transform:translateX(-50%);` +
        `white-space:nowrap;background:rgba(255,255,255,.92);color:#0f172a;padding:2px 7px;` +
        `border-radius:6px;font-size:12px;font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.2)">` +
        `${escapeHtml(desc.text)}</div>`
      : "";
    el.innerHTML = label + pinSvg(desc.color);
  } else {
    el.style.background = "rgba(255,255,255,.85)";
    el.style.padding = "3px 8px";
    el.style.borderRadius = "6px";
    el.style.fontWeight = "600";
    el.style.fontSize = "13px";
    el.style.boxShadow = "0 1px 4px rgba(0,0,0,.2)";
    el.style.color = desc.color;
    el.textContent = desc.text || "Testo";
  }
  return el;
}

