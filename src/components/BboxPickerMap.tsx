/**
 * Bbox-picker map widget.
 *
 * In fullscreen mode: pan/zoom freely; click the "Disegna area" toggle to
 * enter draw mode, then drag a rectangle. After a successful draw the tool
 * auto-exits draw mode so the user can inspect/pan without re-activating.
 *
 * In mini-map (sidebar) mode: draw mode is always on (compact UX).
 *
 * No extra dependencies beyond maplibre-gl (already in the bundle).
 */
import { useEffect, useRef, useState } from "react";
import { Pencil, Move } from "lucide-react";
import maplibregl from "maplibre-gl";
import type { BboxValue } from "../studio/types";
import { useI18n } from "../i18n/LanguageContext";

interface Props {
  /** Current bbox (controlled). Null = nothing drawn yet. */
  value: BboxValue | null;
  /** Called when the user finishes drawing a new bbox. */
  onChange: (bbox: BboxValue) => void;
  /**
   * When true, the map fills its parent container (h-full) instead of the
   * fixed 180px used in the sidebar mini-map mode.
   */
  fullscreen?: boolean;
}

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const SRC_ID = "bbox-rect";
const FILL_ID = "bbox-fill";
const LINE_ID = "bbox-line";

export function BboxPickerMap({ value, onChange, fullscreen = false }: Props) {
  const { dict } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const dragging = useRef(false);
  const startPx = useRef<{ x: number; y: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<string | null>(null);

  /**
   * In fullscreen mode the user starts with pan/zoom free and must explicitly
   * activate draw mode via the toggle button.
   * In mini-map mode draw mode is always on.
   */
  const [drawActive, setDrawActive] = useState(!fullscreen);

  // Sync the GeoJSON bbox rectangle when `value` changes externally
  const syncRect = (map: maplibregl.Map, bbox: BboxValue | null) => {
    if (!map.isStyleLoaded()) return;
    const src = map.getSource(SRC_ID) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!bbox) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const { west, south, east, north } = bbox;
    src.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [west, south],
                [east, south],
                [east, north],
                [west, north],
                [west, south],
              ],
            ],
          },
          properties: {},
        },
      ],
    });
  };

  // Mount MapLibre once
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: [15, 42],
      zoom: 1.2,
      minZoom: 0.5,
      maxZoom: 14,
      attributionControl: false,
      // Disable rotation and pitch - unnecessary for bbox selection
      dragRotate: false,
      pitchWithRotate: false,
      keyboard: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      map.addSource(SRC_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: FILL_ID,
        type: "fill",
        source: SRC_ID,
        paint: { "fill-color": "#4f7ef8", "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: LINE_ID,
        type: "line",
        source: SRC_ID,
        paint: { "line-color": "#4f7ef8", "line-width": 1.8 },
      });
      // Show existing value if any
      syncRect(map, value);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync rect when value prop changes after mount
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) {
      syncRect(map, value);
    } else {
      map.once("load", () => syncRect(map, value));
    }
  }, [value]);

  // Pointer event handlers on the canvas overlay
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const map = mapRef.current;
    if (!map || e.button !== 0 || !drawActive) return;
    dragging.current = true;
    startPx.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
    setHint(null);
    map.dragPan.disable();
    map.scrollZoom.disable();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !startPx.current || !overlayRef.current) return;
    const rect = containerRef.current!.getBoundingClientRect();
    const x0 = startPx.current.x - rect.left;
    const y0 = startPx.current.y - rect.top;
    const x1 = e.clientX - rect.left;
    const y1 = e.clientY - rect.top;
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    const width = Math.abs(x1 - x0);
    const height = Math.abs(y1 - y0);
    Object.assign(overlayRef.current.style, {
      display: "block",
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const map = mapRef.current;
    if (!dragging.current || !startPx.current || !map) return;
    dragging.current = false;

    // Hide overlay rectangle
    if (overlayRef.current) overlayRef.current.style.display = "none";

    // Re-enable map interactions
    map.dragPan.enable();
    map.scrollZoom.enable();

    const rect = containerRef.current!.getBoundingClientRect();
    const x0 = startPx.current.x - rect.left;
    const y0 = startPx.current.y - rect.top;
    const x1 = e.clientX - rect.left;
    const y1 = e.clientY - rect.top;

    // Too small → treat as a click (pan intent), ignore
    if (Math.abs(x1 - x0) < 8 || Math.abs(y1 - y0) < 8) {
      startPx.current = null;
      return;
    }

    const sw = map.unproject([Math.min(x0, x1), Math.max(y0, y1)]);
    const ne = map.unproject([Math.max(x0, x1), Math.min(y0, y1)]);

    const bbox: BboxValue = {
      south: Math.max(-90, Math.min(90, sw.lat)),
      west: Math.max(-180, Math.min(180, sw.lng)),
      north: Math.max(-90, Math.min(90, ne.lat)),
      east: Math.max(-180, Math.min(180, ne.lng)),
    };

    startPx.current = null;
    onChange(bbox);
    setHint(`${bbox.west.toFixed(2)},${bbox.south.toFixed(2)} → ${bbox.east.toFixed(2)},${bbox.north.toFixed(2)}`);
    // In fullscreen: auto-exit draw mode after a successful draw so the user
    // can pan/zoom to inspect the selected area without needing to deactivate.
    if (fullscreen) setDrawActive(false);
  };

  return (
    <div className={fullscreen ? "h-full" : "space-y-1"}>
      <div
        className={`relative overflow-hidden${fullscreen ? " h-full" : " rounded-lg border border-slate-200"}`}
        style={fullscreen ? undefined : { height: 180 }}
      >
        {/* MapLibre container */}
        <div ref={containerRef} className="absolute inset-0" />

        {/* Transparent pointer-capture overlay - only active in draw mode */}
        {drawActive && (
          <div
            className="absolute inset-0"
            style={{ cursor: "crosshair", zIndex: 10 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        )}

        {/* Visual selection rectangle during drag */}
        <div
          ref={overlayRef}
          className="pointer-events-none absolute hidden rounded-sm border border-blue-500 bg-blue-400/20"
          style={{ zIndex: 11 }}
        />

        {/* Mode toggle - segmented control, visible only in fullscreen mode */}
        {fullscreen && (
          <div className="absolute left-3 top-3 z-20 flex gap-1 rounded-lg bg-white/95 p-1 shadow-md backdrop-blur">
            <button
              onClick={() => setDrawActive(false)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                !drawActive
                  ? "bg-zornade text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Move size={13} /> {dict.bboxPickerMap.moveZoom}
            </button>
            <button
              onClick={() => setDrawActive(true)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                drawActive
                  ? "bg-zornade text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Pencil size={13} /> {dict.bboxPickerMap.selectArea}
            </button>
          </div>
        )}

        {/* Instruction overlay when nothing drawn */}
        {!value && !drawActive && fullscreen && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center"
            style={{ zIndex: 12 }}
          >
            <span className="rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white">
              Clicca "Seleziona area" in alto a sinistra, poi trascina sulla mappa
            </span>
          </div>
        )}
        {!value && drawActive && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center"
            style={{ zIndex: 12 }}
          >
            <span className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white">
              Trascina per selezionare un'area
            </span>
          </div>
        )}
      </div>

      {hint && (
        <p className="text-[11px] font-mono text-slate-500">{hint}</p>
      )}
    </div>
  );
}
