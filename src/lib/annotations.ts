/**
 * Custom map annotations (ROADMAP O3.4).
 *
 * The editor lets the operator place four kinds of **geo-anchored** annotations
 * on top of the map — they are stored in lng/lat so they stay glued to the
 * geography while the reader pans/zooms:
 *
 *  - **marker** — a pin with an optional text label;
 *  - **text**   — a free-standing text label;
 *  - **line**   — a segment, optionally with an arrow head at the end;
 *  - **area**   — a highlight shape (rectangle or circle).
 *
 * This module is **pure and deterministic** (no DOM, no side effects): it owns
 * the data model, the small bit of geodesy needed to turn the primitives into
 * GeoJSON, and a defensive sanitiser so a hand-edited / untrusted spec can be
 * rendered safely. Both the editor preview (MapPreview) and the published embed
 * (embed-html) render from the exact same geometry produced here, so what you
 * draw is what gets published.
 */

/** A `[lng, lat]` position (WGS84). */
export type LngLat = [number, number];

export type AnnotationType = "marker" | "text" | "line" | "area";

/** Highlight shapes available to the **area** annotation. */
export type AreaShape = "rectangle" | "circle";

export interface MarkerAnnotation {
  id: string;
  type: "marker";
  lng: number;
  lat: number;
  /** Optional label shown next to the pin ("" = pin only). */
  label: string;
  /** Pin colour (hex). */
  color: string;
}

export interface TextAnnotation {
  id: string;
  type: "text";
  lng: number;
  lat: number;
  /** Label text. */
  text: string;
  /** Text colour (hex). */
  color: string;
}

export interface LineAnnotation {
  id: string;
  type: "line";
  start: LngLat;
  end: LngLat;
  /** Draw an arrow head at `end`. */
  arrow: boolean;
  color: string;
  /** Stroke width in px. */
  width: number;
}

export interface AreaAnnotation {
  id: string;
  type: "area";
  shape: AreaShape;
  /** rectangle: one corner; circle: the centre. */
  a: LngLat;
  /** rectangle: the opposite corner; circle: a point on the edge. */
  b: LngLat;
  color: string;
  /** Fill opacity (0–1). */
  opacity: number;
}

export type Annotation =
  | MarkerAnnotation
  | TextAnnotation
  | LineAnnotation
  | AreaAnnotation;

/**
 * A drawing tool armed in the editor for placement on the map. It carries the
 * sub-variant (arrow vs plain line, rectangle vs circle) so the panel can offer
 * each as a distinct button while the map only needs to know how many clicks a
 * placement takes.
 */
export type DrawTool =
  | { kind: "marker" }
  | { kind: "text" }
  | { kind: "line"; arrow: boolean }
  | { kind: "area"; shape: AreaShape };

/** Default colour for a new annotation (a high-contrast rose). */
export const DEFAULT_ANNOTATION_COLOR = "#e11d48";
/** Default stroke width for a line/arrow (px). */
export const DEFAULT_LINE_WIDTH = 3;
/** Default fill opacity for a highlight area. */
export const DEFAULT_AREA_OPACITY = 0.25;

/** A small curated palette offered in the annotation editor. */
export const ANNOTATION_PALETTE: string[] = [
  "#e11d48", // rose
  "#f59e0b", // amber
  "#16a34a", // green
  "#2563eb", // blue
  "#7c3aed", // violet
  "#0f172a", // slate-900
  "#ffffff", // white
];

/** Mean Earth radius (metres) — for distance + offset, kept consistent. */
const EARTH_R = 6371008.8;
/** Metres per degree of latitude (and of longitude at the equator). */
const M_PER_DEG = (Math.PI / 180) * EARTH_R;
const RAD = Math.PI / 180;

/** Generate a short unique id for a new annotation (UI-side, not pure). */
export function newAnnotationId(): string {
  return `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// --- Factories ------------------------------------------------------------

export function makeMarker(
  id: string,
  lng: number,
  lat: number,
  color: string,
  label = "",
): MarkerAnnotation {
  return { id, type: "marker", lng, lat, label, color };
}

export function makeText(
  id: string,
  lng: number,
  lat: number,
  color: string,
  text: string,
): TextAnnotation {
  return { id, type: "text", lng, lat, text, color };
}

export function makeLine(
  id: string,
  start: LngLat,
  end: LngLat,
  color: string,
  width: number,
  arrow: boolean,
): LineAnnotation {
  return { id, type: "line", start, end, arrow, color, width };
}

export function makeArea(
  id: string,
  shape: AreaShape,
  a: LngLat,
  b: LngLat,
  color: string,
  opacity: number,
): AreaAnnotation {
  return { id, type: "area", shape, a, b, color, opacity };
}

// --- Geometry -------------------------------------------------------------

/** Great-circle distance between two positions, in metres (Haversine). */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLng = (b[0] - a[0]) * RAD;
  const la1 = a[1] * RAD;
  const la2 = b[1] * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The closed ring of an axis-aligned rectangle from two opposite corners.
 * Returns five `[lng, lat]` positions (last == first).
 */
export function rectangleRing(a: LngLat, b: LngLat): LngLat[] {
  return [
    [a[0], a[1]],
    [b[0], a[1]],
    [b[0], b[1]],
    [a[0], b[1]],
    [a[0], a[1]],
  ];
}

/**
 * A closed polygon approximating a geographic circle centred on `center` and
 * passing through `edge`. `steps` segments (default 64). The longitude offset
 * is corrected by the cosine of the latitude so the shape stays round on the
 * map at typical (non-polar) latitudes.
 */
export function circleRing(
  center: LngLat,
  edge: LngLat,
  steps = 64,
): LngLat[] {
  const r = haversineMeters(center, edge);
  const cosLat = Math.cos(center[1] * RAD) || 1e-6;
  const ring: LngLat[] = [];
  for (let i = 0; i < steps; i++) {
    const ang = (i / steps) * 2 * Math.PI;
    const latOff = (r * Math.cos(ang)) / M_PER_DEG;
    const lngOff = (r * Math.sin(ang)) / (M_PER_DEG * cosLat);
    ring.push([center[0] + lngOff, center[1] + latOff]);
  }
  if (ring.length > 0) ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

/**
 * The two barb endpoints of an arrow head drawn at `end`, pointing back toward
 * `start`. Computed in a latitude-corrected plane so the head looks symmetric
 * on the map; the head length is a fixed fraction of the segment length, so it
 * scales naturally with the line. Returns `[barb1, barb2]`.
 */
export function arrowBarbs(start: LngLat, end: LngLat): [LngLat, LngLat] {
  const headFrac = 0.22;
  const headAngle = 26 * RAD;
  const lat0 = ((start[1] + end[1]) / 2) * RAD;
  const cos0 = Math.cos(lat0) || 1e-6;

  const sx = start[0] * cos0;
  const ex = end[0] * cos0;
  let dx = ex - sx;
  let dy = end[1] - start[1];
  const len = Math.hypot(dx, dy) || 1e-9;
  dx /= len;
  dy /= len;
  // Reverse (end → start) direction.
  const rx = -dx;
  const ry = -dy;
  const hl = len * headFrac;
  const rot = (ang: number): [number, number] => [
    rx * Math.cos(ang) - ry * Math.sin(ang),
    rx * Math.sin(ang) + ry * Math.cos(ang),
  ];
  const [b1x, b1y] = rot(headAngle);
  const [b2x, b2y] = rot(-headAngle);
  return [
    [(ex + b1x * hl) / cos0, end[1] + b1y * hl],
    [(ex + b2x * hl) / cos0, end[1] + b2y * hl],
  ];
}

// --- Rendering data -------------------------------------------------------

/**
 * Turn line + area annotations into a GeoJSON `FeatureCollection` ready for a
 * MapLibre line/fill layer. Each feature carries paint values in its
 * properties so a single data-driven layer renders them all:
 *  - `__color`   stroke / fill colour,
 *  - `__width`   stroke width (px),
 *  - `__opacity` fill opacity (areas; 1 for lines),
 *  - `__id`      the source annotation id.
 * Markers and text labels are **not** included here — they are rendered as DOM
 * markers (see {@link markerAnnotations}).
 */
export function annotationsToGeoJson(
  annotations: Annotation[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const a of annotations) {
    if (a.type === "line") {
      features.push(lineFeature(a.id, [a.start, a.end], a.color, a.width));
      if (a.arrow) {
        const [b1, b2] = arrowBarbs(a.start, a.end);
        features.push(lineFeature(a.id, [a.end, b1], a.color, a.width));
        features.push(lineFeature(a.id, [a.end, b2], a.color, a.width));
      }
    } else if (a.type === "area") {
      const ring =
        a.shape === "circle" ? circleRing(a.a, a.b) : rectangleRing(a.a, a.b);
      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          __id: a.id,
          __color: a.color,
          __opacity: a.opacity,
          __width: 1.5,
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

function lineFeature(
  id: string,
  coordinates: LngLat[],
  color: string,
  width: number,
): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties: { __id: id, __color: color, __width: width, __opacity: 1 },
  };
}

/** A marker/text annotation reduced to what a DOM marker needs to render. */
export interface MarkerDescriptor {
  id: string;
  type: "marker" | "text";
  lng: number;
  lat: number;
  color: string;
  /** Marker label or text-annotation content (may be ""). */
  text: string;
}

/** The marker + text annotations, as flat descriptors for DOM rendering. */
export function markerAnnotations(
  annotations: Annotation[],
): MarkerDescriptor[] {
  const out: MarkerDescriptor[] = [];
  for (const a of annotations) {
    if (a.type === "marker") {
      out.push({ id: a.id, type: "marker", lng: a.lng, lat: a.lat, color: a.color, text: a.label });
    } else if (a.type === "text") {
      out.push({ id: a.id, type: "text", lng: a.lng, lat: a.lat, color: a.color, text: a.text });
    }
  }
  return out;
}

// --- Sanitising (untrusted input) -----------------------------------------

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function lngLat(v: unknown): LngLat | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const lng = num(v[0]);
  const lat = num(v[1]);
  return lng != null && lat != null ? [lng, lat] : null;
}

function color(v: unknown): string {
  return typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v)
    ? v
    : DEFAULT_ANNOTATION_COLOR;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Validate an arbitrary value (e.g. parsed from a saved project or an inlined
 * spec) into a clean `Annotation[]`. Unknown/invalid entries are dropped and
 * numeric fields are clamped, so a malformed input degrades to "fewer / safer
 * annotations" instead of crashing the renderer. Text is **not** HTML-escaped
 * here — escaping happens at the render boundary.
 */
export function sanitizeAnnotations(value: unknown): Annotation[] {
  if (!Array.isArray(value)) return [];
  const out: Annotation[] = [];
  for (const raw of value) {
    if (raw == null || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === "string" && r.id !== "" ? r.id : newAnnotationId();
    if (r.type === "marker") {
      const lng = num(r.lng);
      const lat = num(r.lat);
      if (lng == null || lat == null) continue;
      out.push(makeMarker(id, lng, lat, color(r.color), str(r.label)));
    } else if (r.type === "text") {
      const lng = num(r.lng);
      const lat = num(r.lat);
      if (lng == null || lat == null) continue;
      out.push(makeText(id, lng, lat, color(r.color), str(r.text)));
    } else if (r.type === "line") {
      const start = lngLat(r.start);
      const end = lngLat(r.end);
      if (!start || !end) continue;
      const width = clamp(num(r.width) ?? DEFAULT_LINE_WIDTH, 1, 40);
      out.push(makeLine(id, start, end, color(r.color), width, r.arrow === true));
    } else if (r.type === "area") {
      const a = lngLat(r.a);
      const b = lngLat(r.b);
      if (!a || !b) continue;
      const shape: AreaShape = r.shape === "circle" ? "circle" : "rectangle";
      const opacity = clamp(num(r.opacity) ?? DEFAULT_AREA_OPACITY, 0, 1);
      out.push(makeArea(id, shape, a, b, color(r.color), opacity));
    }
  }
  return out;
}

/** Human label for an annotation row in the editor list. */
export function annotationSummary(a: Annotation): string {
  switch (a.type) {
    case "marker":
      return a.label ? `Marker · ${a.label}` : "Marker";
    case "text":
      return a.text ? `Testo · ${a.text}` : "Testo";
    case "line":
      return a.arrow ? "Freccia" : "Linea";
    case "area":
      return a.shape === "circle" ? "Evidenzia · cerchio" : "Evidenzia · rettangolo";
  }
}
