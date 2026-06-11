import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Flavor } from "@protomaps/basemaps";
import { buildStyle } from "../basemap";
import { ensurePmtilesProtocol } from "../lib/pmtiles";

/** A choropleth data layer to overlay on the basemap. */
export interface DataLayer {
  geojson: GeoJSON.FeatureCollection;
  /** MapLibre paint expression for `fill-color`. */
  fillColor: unknown;
  /** Outline colour for the polygons. */
  lineColor?: string;
  /** Feature property holding the area name (for tooltips). */
  nameField?: string;
  /** Human label for the mapped value (for tooltips). */
  valueLabel?: string;
  /** Optional unit appended to the value (for tooltips). */
  valueUnit?: string;
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
   * External MapLibre style URL to use as the basemap (e.g. OpenFreeMap).
   * When set, it takes priority over the bundled Protomaps/PMTiles style and
   * the choropleth is overlaid on top of it.
   */
  basemapUrl?: string | null;
}

// Centred on the Italian peninsula.
const INITIAL_CENTER: [number, number] = [12.5, 42.5];
const INITIAL_ZOOM = 5;

const SRC = "studio-data";
const FILL = "studio-data-fill";
const LINE = "studio-data-line";

/** Italian number formatting for tooltip values. */
const fmt = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

export function MapPreview({
  tilesUrl,
  flavor,
  lang = "it",
  dataLayer = null,
  tooltip = true,
  zoomPan = true,
  basemap = true,
  basemapUrl = null,
}: MapPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const dataLayerRef = useRef<DataLayer | null>(dataLayer);
  dataLayerRef.current = dataLayer;
  const navControlRef = useRef<maplibregl.NavigationControl | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const tooltipEnabledRef = useRef<boolean>(tooltip);
  tooltipEnabledRef.current = tooltip;

  // Add/update/remove the choropleth source + layers. Re-runs after every
  // setStyle (which wipes custom layers), so it is idempotent.
  const syncData = (map: maplibregl.Map) => {
    if (!map.isStyleLoaded()) {
      map.once("idle", () => syncData(map));
      return;
    }
    if (map.getLayer(LINE)) map.removeLayer(LINE);
    if (map.getLayer(FILL)) map.removeLayer(FILL);
    if (map.getSource(SRC)) map.removeSource(SRC);

    const layer = dataLayerRef.current;
    if (!layer) return;

    map.addSource(SRC, { type: "geojson", data: layer.geojson });

    // Insert below the first symbol layer so place labels stay readable.
    const firstSymbol = map
      .getStyle()
      .layers?.find((l) => l.type === "symbol")?.id;

    map.addLayer(
      {
        id: FILL,
        type: "fill",
        source: SRC,
        paint: {
          "fill-color": layer.fillColor as maplibregl.ExpressionSpecification,
          "fill-opacity": 0.82,
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
          "line-width": 0.6,
        },
      },
      firstSymbol,
    );
  };

  // Resolve the MapLibre style: an external URL (OpenFreeMap) takes priority,
  // otherwise build the bundled Protomaps/PMTiles style.
  const resolveStyle = ():
    | string
    | maplibregl.StyleSpecification => {
    if (basemapUrl) return basemapUrl;
    return buildStyle({
      tilesUrl,
      flavor,
      lang,
      basemap,
    }) as maplibregl.StyleSpecification;
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
    });
    const nav = new maplibregl.NavigationControl({ showCompass: false });
    navControlRef.current = nav;
    map.addControl(nav, "top-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          'Dati e mappa: <a href="https://zornade.com" target="_blank" rel="noopener">Zornade</a>',
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
      popup
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="studio-tooltip-name">${escapeHtml(String(name ?? ""))}</div>` +
            `<div class="studio-tooltip-value"><span>${escapeHtml(label)}</span> ${escapeHtml(value)}</div>`,
        )
        .addTo(map);
    });
    map.on("mouseleave", FILL, () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });

    map.on("load", () => syncData(map));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // The map is created once; style updates are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-apply the style whenever the flavor, tiles URL, language, label font or
  // external basemap URL changes. MapLibre preserves the camera across setStyle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(resolveStyle());
    syncData(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilesUrl, flavor, lang, basemap, basemapUrl]);

  // Re-sync the overlay whenever the data layer changes.
  useEffect(() => {
    const map = mapRef.current;
    if (map) syncData(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLayer]);

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

  return <div ref={containerRef} className="h-full w-full" />;
}

/** Minimal HTML escaping for tooltip content. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
