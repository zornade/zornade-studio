import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { Flavor } from "@protomaps/basemaps";
import { buildStyle } from "../basemap";
import { ensurePmtilesProtocol } from "../lib/pmtiles";
import { renderTooltipTemplate } from "../lib/tooltip";

/** A choropleth data layer to overlay on the basemap. */
export interface DataLayer {
  geojson: GeoJSON.FeatureCollection;
  /**
   * "area" → fill+line choropleth (default); "point" → circle layer;
   * "geo" → the user's own geometry (polygons/lines/points drawn together).
   */
  kind?: "area" | "point" | "geo";
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
  /** Feature property holding the area name (for tooltips). */
  nameField?: string;
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
   * External MapLibre style URL to use as the basemap (e.g. OpenFreeMap).
   * When set, it takes priority over the bundled Protomaps/PMTiles style and
   * the choropleth is overlaid on top of it.
   */
  basemapUrl?: string | null;
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
}

// Centred on the Italian peninsula.
const INITIAL_CENTER: [number, number] = [12.5, 42.5];
const INITIAL_ZOOM = 5;

const SRC = "studio-data";
const FILL = "studio-data-fill";
const LINE = "studio-data-line";
/** Extra layer for points inside a user "geo" dataset (KML/Shapefile points). */
const GEO_POINT = "studio-geo-point";

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
  fitKey = null,
  dataFilter = null,
}: MapPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const dataLayerRef = useRef<DataLayer | null>(dataLayer);
  dataLayerRef.current = dataLayer;
  const dataFilterRef = useRef<unknown | null>(dataFilter);
  dataFilterRef.current = dataFilter;
  const navControlRef = useRef<maplibregl.NavigationControl | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const tooltipEnabledRef = useRef<boolean>(tooltip);
  tooltipEnabledRef.current = tooltip;
  const lastFitRef = useRef<string | null>(null);

  // Add/update/remove the choropleth source + layers. Re-runs after every
  // setStyle (which wipes custom layers), so it is idempotent.
  const syncData = (map: maplibregl.Map) => {
    if (!map.isStyleLoaded()) {
      map.once("idle", () => syncData(map));
      return;
    }
    if (map.getLayer(GEO_POINT)) map.removeLayer(GEO_POINT);
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
            "circle-opacity": 0.9,
          },
        },
        firstSymbol,
      );
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
      // Required so the WebGL canvas can be read back for PNG export (O1.5).
      preserveDrawingBuffer: true,
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
      popup
        .setLngLat(e.lngLat)
        .setHTML(html)
        .addTo(map);
    });
    map.on("mouseleave", FILL, () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    });

    // Geo datasets also draw lines and points; bind the same hover handlers so
    // the tooltip works on every primitive (a single popup, last layer wins).
    const showOnLayer = (
      e: maplibregl.MapLayerMouseEvent,
    ) => {
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
      if (mapRef.current) syncData(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilesUrl, flavor, lang, basemap, basemapUrl]);

  // Re-sync the overlay whenever the data layer changes.
  useEffect(() => {
    const map = mapRef.current;
    if (map) syncData(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLayer]);

  // Re-apply the reader class filter when it changes (without rebuilding data).
  useEffect(() => {
    const map = mapRef.current;
    if (map) applyDataFilter(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataFilter]);

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
