/**
 * Point-marker shapes and the single source of truth for their rendered SVG.
 *
 * Locator and plain point maps can draw their points as **markers** (a filled
 * shape with a white outline, optionally with a FontAwesome glyph knocked out
 * in white inside) instead of plain circles. Because the published embed is
 * immutable, the marker geometry must be produced identically in the live
 * editor ([MapPreview]) and in the inlined embed renderer ([embed-html]). To
 * avoid drifting twin implementations, this module emits a single **SVG
 * template** with a `__C__` colour placeholder: both renderers substitute the
 * colour, rasterise the SVG to a bitmap and register it with
 * `map.addImage(...)`, then a MapLibre symbol layer references it.
 *
 * The functions here are pure (string/array builders), so they are unit-tested
 * without a DOM; the rasterisation itself is browser-only and lives where the
 * map is created.
 */

/** Colour placeholder substituted (per category) before rasterising. */
export const MARKER_COLOR_TOKEN = "__C__";

/** A selectable marker shape (the visual container of the point). */
export interface MarkerShape {
  id: string;
  label: string;
  /**
   * Where the rendered image sits relative to the geographic point. Teardrop
   * pins anchor at their bottom tip; symmetric shapes anchor at their centre.
   */
  anchor: "center" | "bottom";
}

/**
 * Available marker shapes, in picker order. `circle` is the default and, with
 * no icon, keeps the historical plain circle-layer rendering (so published
 * embeds stay byte-identical until the operator opts into a marker).
 */
export const MARKER_SHAPES: MarkerShape[] = [
  { id: "circle", label: "Cerchio", anchor: "center" },
  { id: "pin", label: "Spillo", anchor: "bottom" },
  { id: "square", label: "Quadrato", anchor: "center" },
  { id: "diamond", label: "Rombo", anchor: "center" },
  { id: "triangle", label: "Triangolo", anchor: "center" },
  { id: "pentagon", label: "Pentagono", anchor: "center" },
  { id: "hexagon", label: "Esagono", anchor: "center" },
  { id: "star", label: "Stella", anchor: "center" },
];

const SHAPE_BY_ID = new Map(MARKER_SHAPES.map((s) => [s.id, s]));

/** Whether `shapeId` is a known marker shape. */
export function isMarkerShape(shapeId: string): boolean {
  return SHAPE_BY_ID.has(shapeId);
}

/** Anchor for a shape ("center", or "bottom" for the teardrop pin). */
export function markerAnchor(shapeId: string): "center" | "bottom" {
  return SHAPE_BY_ID.get(shapeId)?.anchor ?? "center";
}

/**
 * Whether a marker rendering is needed at all. The plain circle layer is used
 * (and the embed stays byte-identical) only when the shape is "circle" AND no
 * icon is chosen; any other shape or any icon switches to the symbol renderer.
 */
export function usesMarkerLayer(shapeId: string, iconPath: string): boolean {
  return (shapeId !== "" && shapeId !== "circle") || iconPath !== "";
}

/** Round to 2 decimals to keep the emitted SVG compact and deterministic. */
function r2(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/**
 * Points of a regular `n`-gon inscribed in radius `rad` around (`cx`,`cy`),
 * with the first vertex pointing up (`-90°`). Returns SVG path commands.
 */
function regularPolygon(n: number, cx: number, cy: number, rad: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = (-90 + (360 / n) * i) * (Math.PI / 180);
    pts.push(`${r2(cx + rad * Math.cos(a))},${r2(cy + rad * Math.sin(a))}`);
  }
  return `M${pts.join("L")}Z`;
}

/**
 * Points of a `n`-pointed star (outer radius `rad`, inner `rad*innerRatio`)
 * around (`cx`,`cy`), first outer point up. Returns SVG path commands.
 */
function starPolygon(
  n: number,
  cx: number,
  cy: number,
  rad: number,
  innerRatio: number,
): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const rr = i % 2 === 0 ? rad : rad * innerRatio;
    const a = (-90 + (180 / n) * i) * (Math.PI / 180);
    pts.push(`${r2(cx + rr * Math.cos(a))},${r2(cy + rr * Math.sin(a))}`);
  }
  return `M${pts.join("L")}Z`;
}

/** The geometry of a centred shape inside the 100×100 marker box. */
function shapeMarkup(shapeId: string): string {
  const cx = 50;
  const cy = 50;
  const rad = 42;
  const fill = `fill="${MARKER_COLOR_TOKEN}" stroke="#ffffff" stroke-width="7" stroke-linejoin="round"`;
  switch (shapeId) {
    case "square":
      return `<rect x="12" y="12" width="76" height="76" rx="10" ${fill}/>`;
    case "diamond":
      return `<path d="${regularPolygon(4, cx, cy, rad)}" ${fill}/>`;
    case "triangle":
      return `<path d="${regularPolygon(3, cx, cy + 6, rad + 4)}" ${fill}/>`;
    case "pentagon":
      return `<path d="${regularPolygon(5, cx, cy + 2, rad)}" ${fill}/>`;
    case "hexagon":
      return `<path d="${regularPolygon(6, cx, cy, rad)}" ${fill}/>`;
    case "star":
      return `<path d="${starPolygon(5, cx, cy + 2, rad + 3, 0.42)}" ${fill}/>`;
    case "circle":
    default:
      return `<circle cx="${cx}" cy="${cy}" r="${rad}" ${fill}/>`;
  }
}

/**
 * The icon glyph `<path>` placed and scaled to sit inside a marker, knocked out
 * in white. `iconPath` is the raw FontAwesome path data, drawn in its native
 * `iconW × 512` viewBox; we scale it to `box` px and centre it at (`cx`,`cy`).
 */
function iconMarkup(
  iconPath: string,
  iconW: number,
  iconH: number,
  cx: number,
  cy: number,
  box: number,
): string {
  if (!iconPath) return "";
  const w = iconW > 0 ? iconW : 512;
  const h = iconH > 0 ? iconH : 512;
  const s = box / Math.max(w, h);
  const tx = cx - (w * s) / 2;
  const ty = cy - (h * s) / 2;
  return `<path transform="translate(${r2(tx)} ${r2(ty)}) scale(${r2(s)})" d="${iconPath}" fill="#ffffff"/>`;
}

/** Intrinsic pixel dimensions of a marker shape's SVG (before scaling). */
export function markerViewBox(shapeId: string): { width: number; height: number } {
  return shapeId === "pin" ? { width: 100, height: 140 } : { width: 100, height: 100 };
}

/**
 * Build the marker's SVG **template**: a complete, self-contained `<svg>` whose
 * single fill colour is the literal {@link MARKER_COLOR_TOKEN}. Callers replace
 * the token with each concrete colour, then rasterise. The geometry (shape +
 * icon placement) is defined only here, so the editor and the embed render
 * pixel-identical markers from the same template.
 */
export function markerSvgTemplate(
  shapeId: string,
  iconPath = "",
  iconW = 0,
  iconH = 0,
): string {
  if (shapeId === "pin") {
    // Teardrop with the head centred at (50,52) and the tip at the box bottom.
    const head =
      `<path d="M50 4C26.8 4 8 22.8 8 46c0 29.4 42 90 42 90s42-60.6 42-90` +
      `C92 22.8 73.2 4 50 4Z" fill="${MARKER_COLOR_TOKEN}" stroke="#ffffff" stroke-width="7" stroke-linejoin="round"/>`;
    const inner = iconPath
      ? iconMarkup(iconPath, iconW, iconH, 50, 48, 46)
      : `<circle cx="50" cy="48" r="17" fill="#ffffff"/>`;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 140">` +
      head +
      inner +
      `</svg>`
    );
  }
  const shape = shapeMarkup(shapeId);
  const icon = iconMarkup(iconPath, iconW, iconH, 50, 50, shapeId === "triangle" ? 38 : 50);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    shape +
    icon +
    `</svg>`
  );
}

/** Stable id for an addImage entry, unique per shape/icon/colour/size/dpr. */
export function markerImageId(
  shapeId: string,
  iconKey: string,
  color: string,
  sizePx: number,
  dpr: number,
): string {
  return `mk:${shapeId}:${iconKey}:${color}:${sizePx}:${dpr}`;
}

/** On-screen marker width in CSS px derived from the base point size. */
export function markerPixelSize(pointSize: number): number {
  return Math.max(14, Math.min(96, Math.round(pointSize * 3)));
}
