import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Flavor } from "@protomaps/basemaps";
import { buildStyle } from "../basemap";
import { ensurePmtilesProtocol } from "../lib/pmtiles";
import { renderTooltipTemplate } from "../lib/tooltip";
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
 * Bounding-box centre of a GeoJSON geometry, used to anchor the 3D-extrusion
 * tooltip to a feature's footprint (the raw event `lngLat` is the ground point
 * under the cursor, which drifts far from a tall bar when the map is pitched).
 */
function featureCenter(geom: GeoJSON.Geometry | null | undefined): [number, number] | null {
  if (!geom || !("coordinates" in geom)) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else if (Array.isArray(c)) {
      for (const child of c) visit(child);
    }
  };
  visit((geom as { coordinates: unknown }).coordinates);
  if (!Number.isFinite(minX)) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/**
 * Add a subtle sky + atmospheric haze. On a pitched 2D map it draws a soft
 * horizon; on the globe it gives the planet a blue atmosphere halo. The
 * atmosphere fades out as the camera zooms in so it never washes out the data.
 * setStyle() wipes the sky, so this is re-applied after every (re)style.
 */
function applySky(map: maplibregl.Map, globe: boolean): void {
  try {
    map.setSky({
      "sky-color": "#a9d3ff",
      "sky-horizon-blend": 0.6,
      "horizon-color": "#eaf3ff",
      "horizon-fog-blend": 0.6,
      "fog-color": "#ffffff",
      "fog-ground-blend": 0.6,
      "atmosphere-blend": [
        "interpolate",
        ["linear"],
        ["zoom"],
        0,
        globe ? 0.9 : 0.6,
        5,
        0.3,
        7,
        0,
      ],
    });
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
    map.setLight({
      anchor: "map",
      color: "#ffffff",
      intensity: 0.55,
      position: [1.5, 215, 40],
    });
  } catch {
    /* setLight unsupported by the current renderer — ignore. */
  }
}

type Star = { x: number; y: number; r: number; p: number; s: number; tw: number };
type Nebula = { x: number; y: number; r: number; vx: number; vy: number; h: number };
type Satellite = { x: number; y: number; vx: number; dir: number; vy: number };

/**
 * Level 1 globe environment for the editor preview — the same lightweight,
 * dependency-free space backdrop shipped in the published embeds (see
 * `SPACE_FX` in embed-html.ts), drawn on a 2D canvas sitting behind the
 * transparent globe. Twinkling starfield, a soft Milky Way band, drifting
 * nebulae, a shaded Moon in the top-right corner and an occasional satellite
 * streak. Returns a handle whose `stop()` cancels the loop, unbinds the resize
 * listener and clears the canvas (called when the globe is toggled off / on
 * unmount). Pure canvas 2D, no WebGL, negligible cost.
 */
function startStarfield(canvas: HTMLCanvasElement): { stop: () => void } {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { stop: () => {} };
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0;
  let H = 0;
  let raf = 0;
  let stars: Star[] = [];
  let neb: Nebula[] = [];
  let sat: Satellite | null = null;
  let satTimer = 12;
  const t0 = Date.now();
  let last = Date.now();

  const build = () => {
    stars = [];
    const n = Math.round(Math.min(280, Math.max(70, (W * H) / 8000)));
    for (let i = 0; i < n; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.1 + 0.25,
        p: Math.random() * 6.2832,
        s: Math.random() * 0.7 + 0.3,
        tw: Math.random() * 1.4 + 0.6,
      });
    }
    neb = [];
    for (let j = 0; j < 3; j++) {
      neb.push({
        x: Math.random() * W,
        y: Math.random() * H * 0.7,
        r: Math.max(W, H) * (0.25 + Math.random() * 0.2),
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 2,
        h: 200 + Math.random() * 40,
      });
    }
  };

  const resize = () => {
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    build();
  };

  const milky = () => {
    const g = ctx.createLinearGradient(0, H * 0.15, W, H * 0.8);
    g.addColorStop(0, "rgba(120,140,210,0)");
    g.addColorStop(0.5, "rgba(150,165,225,0.05)");
    g.addColorStop(1, "rgba(120,140,210,0)");
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  };

  const nebula = (dt: number) => {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    for (const b of neb) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < -b.r) b.x = W + b.r;
      if (b.x > W + b.r) b.x = -b.r;
      if (b.y < -b.r) b.y = H + b.r;
      if (b.y > H + b.r) b.y = -b.r;
      const rg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      rg.addColorStop(0, `hsla(${b.h},60%,62%,0.05)`);
      rg.addColorStop(1, `hsla(${b.h},60%,62%,0)`);
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();
  };

  const moon = () => {
    const mr = Math.max(16, Math.min(W, H) * 0.045);
    const mx = W - mr * 2.6;
    const my = mr * 2.2;
    const gg = ctx.createRadialGradient(mx, my, mr * 0.7, mx, my, mr * 2.6);
    gg.addColorStop(0, "rgba(214,222,244,0.22)");
    gg.addColorStop(1, "rgba(214,222,244,0)");
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(mx, my, mr * 2.6, 0, 6.2832);
    ctx.fill();
    const dg = ctx.createRadialGradient(mx - mr * 0.35, my - mr * 0.35, mr * 0.2, mx, my, mr);
    dg.addColorStop(0, "#f6f7fb");
    dg.addColorStop(1, "#c1c6d4");
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = "rgba(150,156,176,0.32)";
    const cr = (cx: number, cy: number, r: number) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 6.2832);
      ctx.fill();
    };
    cr(mx - mr * 0.28, my - mr * 0.08, mr * 0.17);
    cr(mx + mr * 0.22, my + mr * 0.26, mr * 0.12);
    cr(mx + mr * 0.05, my - mr * 0.34, mr * 0.09);
  };

  const spawnSat = () => {
    const dir = Math.random() < 0.5 ? 1 : -1;
    sat = {
      x: dir > 0 ? -20 : W + 20,
      y: H * (0.12 + Math.random() * 0.5),
      vx: (W + 60) / (7 + Math.random() * 5),
      dir,
      vy: (Math.random() - 0.5) * 8,
    };
  };

  const frame = () => {
    const now = Date.now();
    let dt = (now - last) / 1000;
    if (dt > 0.1) dt = 0.1;
    last = now;
    ctx.clearRect(0, 0, W, H);
    milky();
    nebula(dt);
    const tt = (now - t0) / 1000;
    for (const st of stars) {
      let a = st.s * (0.55 + 0.45 * Math.sin(tt * st.tw + st.p));
      if (a < 0) a = 0;
      ctx.globalAlpha = a;
      ctx.fillStyle = "#eef3ff";
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    moon();
    satTimer -= dt;
    if (!sat && satTimer <= 0) {
      spawnSat();
      satTimer = 18 + Math.random() * 22;
    }
    if (sat) {
      sat.x += sat.dir * sat.vx * dt;
      sat.y += sat.vy * dt;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(180,210,255,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sat.x - sat.dir * 16, sat.y - sat.vy * 0.02);
      ctx.lineTo(sat.x, sat.y);
      ctx.stroke();
      ctx.fillStyle = "rgba(245,250,255,0.95)";
      ctx.beginPath();
      ctx.arc(sat.x, sat.y, 1.5, 0, 6.2832);
      ctx.fill();
      ctx.restore();
      if (sat.x > W + 30 || sat.x < -30) sat = null;
    }
    raf = window.requestAnimationFrame(frame);
  };

  const onResize = () => resize();
  window.addEventListener("resize", onResize);
  resize();
  frame();

  return {
    stop() {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener("resize", onResize);
      ctx.clearRect(0, 0, W, H);
    },
  };
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
  const spaceRef = useRef<HTMLCanvasElement | null>(null);
  const dataLayerRef = useRef<DataLayer | null>(dataLayer);
  dataLayerRef.current = dataLayer;
  const dataFilterRef = useRef<unknown | null>(dataFilter);
  dataFilterRef.current = dataFilter;
  const navControlRef = useRef<maplibregl.NavigationControl | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const tooltipEnabledRef = useRef<boolean>(tooltip);
  tooltipEnabledRef.current = tooltip;
  const lastFitRef = useRef<string | null>(null);
  /** Live globe flag read by the once-bound load/restyle handlers (for sky). */
  const globeRef = useRef<boolean>(globe);
  globeRef.current = globe;
  /** Feature id currently under the cursor (for the hover highlight). */
  const hoveredIdRef = useRef<number | string | null>(null);

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
            (layer.fillColor as maplibregl.ExpressionSpecification) ?? "#01646f",
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
              "#01646f",
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
              "#01646f",
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
              "#01646f",
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
              "#01646f",
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
        customAttribution:
          'Fatto con <a href="https://zornade.com/studio" target="_blank" rel="noopener">Zornade Studio</a>',
      }),
      "bottom-right",
    );

    // Hover tooltip bound once to the data fill layer (persists across the
    // layer being re-created in syncData, since it is keyed by layer id).
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: "studio-tooltip",
    });
    popupRef.current = popup;

    map.on("mousemove", FILL, (e) => {
      if (annotToolRef.current) return;
      if (!tooltipEnabledRef.current) return;
      const f = e.features?.[0];
      if (!f) return;
      map.getCanvas().style.cursor = "pointer";
      // Hover highlight: move the `hover` feature-state to the polygon under the
      // cursor (read by the fill-opacity / line-width paint expressions).
      if (hoveredIdRef.current != null) {
        map.setFeatureState({ source: SRC, id: hoveredIdRef.current }, { hover: false });
      }
      if (f.id != null) {
        hoveredIdRef.current = f.id;
        map.setFeatureState({ source: SRC, id: f.id }, { hover: true });
      }
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
      const html = tpl
        ? renderTooltipTemplate(tpl, tooltipValues(props, String(name ?? ""), value))
        : `<div class="studio-tooltip-name">${escapeHtml(String(name ?? ""))}</div>` +
          `<div class="studio-tooltip-value"><span>${escapeHtml(label)}</span> ${escapeHtml(value)}</div>`;
      popup
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);
    });
    map.on("mouseleave", FILL, () => {
      if (annotToolRef.current) return;
      map.getCanvas().style.cursor = "";
      if (hoveredIdRef.current != null) {
        map.setFeatureState({ source: SRC, id: hoveredIdRef.current }, { hover: false });
        hoveredIdRef.current = null;
      }
      popup.remove();
    });

    // Geo datasets also draw lines and points; bind the same hover handlers so
    // the tooltip works on every primitive (a single popup, last layer wins).
    const showOnLayer = (
      e: maplibregl.MapLayerMouseEvent,
    ) => {
      if (annotToolRef.current) return;
      if (!tooltipEnabledRef.current) return;
      const f = e.features?.[0];
      if (!f) return;
      map.getCanvas().style.cursor = "pointer";
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
      const html = tpl
        ? renderTooltipTemplate(tpl, tooltipValues(props, String(name ?? ""), value))
        : `<div class="studio-tooltip-name">${escapeHtml(String(name ?? ""))}</div>` +
          `<div class="studio-tooltip-value"><span>${escapeHtml(label)}</span> ${escapeHtml(value)}</div>`;
      popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
    };
    const hideOnLayer = () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    };
    for (const id of [LINE, GEO_POINT]) {
      map.on("mousemove", id, showOnLayer);
      map.on("mouseleave", id, hideOnLayer);
    }
    // The 3D extrusion uses its own layer id. Anchor the tooltip at the
    // feature's footprint centre, not the event lngLat: with the map pitched
    // the ground point under the cursor drifts far from a tall bar, making the
    // popup jump around or point at the wrong area.
    const showOnExtrusion = (e: maplibregl.MapLayerMouseEvent) => {
      if (annotToolRef.current) return;
      if (!tooltipEnabledRef.current) return;
      const f = e.features?.[0];
      if (!f) return;
      map.getCanvas().style.cursor = "pointer";
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
      const html = tpl
        ? renderTooltipTemplate(tpl, tooltipValues(props, String(name ?? ""), value))
        : `<div class="studio-tooltip-name">${escapeHtml(String(name ?? ""))}</div>` +
          `<div class="studio-tooltip-value"><span>${escapeHtml(label)}</span> ${escapeHtml(value)}</div>`;
      const anchor = featureCenter(f.geometry) ?? [e.lngLat.lng, e.lngLat.lat];
      popup.setLngLat(anchor).setHTML(html).addTo(map);
    };
    map.on("mousemove", EXTRUSION, showOnExtrusion);
    map.on("mouseleave", EXTRUSION, hideOnLayer);

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
      applySky(map, globeRef.current);
      applyLight(map);
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
        applySky(map, globeRef.current);
        applyLight(map);
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
    if (Math.abs(map.getPitch() - pitch) > 0.5) {
      map.easeTo({ pitch, duration: 500 });
    }
  }, [pitch]);

  // Switch between mercator and globe projection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      map.setProjection(globe ? { type: "globe" } : { type: "mercator" });
      applySky(map, globe);
      applyLight(map);
      if (globe) {
        map.easeTo({ zoom: 1.5, center: [0, 20], duration: 400 });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!tooltip) popupRef.current?.remove();
  }, [tooltip]);

  // Level 1 globe environment: run the canvas starfield only while the globe is
  // on; stop and clear it when switched back to the flat map or on unmount.
  useEffect(() => {
    if (!globe || !spaceRef.current) return;
    const sf = startStarfield(spaceRef.current);
    return () => sf.stop();
  }, [globe]);

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={spaceRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={
          globe
            ? {
                background:
                  "radial-gradient(120% 90% at 50% 28%, #0b1026 0%, #070a18 55%, #03030a 100%)",
              }
            : { display: "none" }
        }
      />
      <div ref={containerRef} className="absolute inset-0 z-[1]" />
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

/**
 * Build the token dictionary for a custom tooltip template from a feature's
 * properties: `nome`, `valore` (already formatted), plus every `col:`-prefixed
 * column carried onto the feature for the template.
 */
function tooltipValues(
  props: Record<string, unknown>,
  name: string,
  value: string,
): Record<string, string> {
  const values: Record<string, string> = { nome: name, valore: value };
  for (const k of Object.keys(props)) {
    if (k.startsWith("col:")) values[k.slice(4)] = String(props[k] ?? "");
  }
  return values;
}

/**
 * Compute the bounding box of the features that carry a numeric `__value`
 * (i.e. the data the user actually mapped), falling back to all features.
 * Handles Polygon / MultiPolygon / Point geometries. Returns null if empty.
 */
function computeBounds(
  geojson: GeoJSON.FeatureCollection,
): [[number, number], [number, number]] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const visit = (lng: number, lat: number) => {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  };

  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (
      coords.length >= 2 &&
      typeof coords[0] === "number" &&
      typeof coords[1] === "number"
    ) {
      visit(coords[0], coords[1]);
      return;
    }
    for (const c of coords) walk(c);
  };

  const withValue = geojson.features.filter(
    (f) => typeof (f.properties as Record<string, unknown>)?.__value === "number",
  );
  const features = withValue.length > 0 ? withValue : geojson.features;
  for (const f of features) {
    if (f.geometry && "coordinates" in f.geometry) {
      walk((f.geometry as { coordinates: unknown }).coordinates);
    }
  }

  if (!Number.isFinite(minLng) || !Number.isFinite(maxLng)) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
