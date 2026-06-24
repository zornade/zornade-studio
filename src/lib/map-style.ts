import maplibregl from "maplibre-gl";

/**
 * Single source of truth for the MapLibre **sky**, **light** and **projection**
 * configuration shared by the live editor preview ([MapPreview](../components/MapPreview.tsx))
 * and the published static embeds ([embed-html.ts](./embed-html.ts)).
 *
 * The editor calls these functions directly; the embed inlines their output as
 * JSON into its self-contained renderer. Keeping a single definition means a
 * change to the atmosphere or lighting is made in exactly one place and stays
 * identical between the preview and the published map.
 */

type SkySpec = Parameters<maplibregl.Map["setSky"]>[0];
type LightSpec = Parameters<maplibregl.Map["setLight"]>[0];
type ProjectionSpec = Parameters<maplibregl.Map["setProjection"]>[0];

/**
 * Subtle sky + atmospheric haze. On a pitched flat map it draws a soft horizon;
 * on the globe **only** the atmosphere halo is drawn, so the space around the
 * planet stays transparent and the host page background shows through. The
 * atmosphere fades out as the camera zooms in so it never washes out the data.
 */
export function skySpec(globe: boolean): SkySpec {
  if (globe) {
    return {
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 5, 0.3, 7, 0],
    };
  }
  return {
    "sky-color": "#a9d3ff",
    "sky-horizon-blend": 0.6,
    "horizon-color": "#eaf3ff",
    "horizon-fog-blend": 0.6,
    "fog-color": "#ffffff",
    "fog-ground-blend": 0.6,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.6, 5, 0.3, 7, 0],
  };
}

/**
 * Directional lighting for the 3D extrusion: a light anchored to the map (so the
 * shading stays consistent with the geography as the camera rotates), coming
 * from the upper-left at a moderate elevation. It shades the sides of the
 * extruded shapes and gives them real volume. Harmless for flat maps — only
 * `fill-extrusion` layers react to it.
 */
export function lightSpec(): LightSpec {
  return { anchor: "map", color: "#ffffff", intensity: 0.55, position: [1.5, 215, 40] };
}

/** Map projection: globe vs flat mercator. */
export function projectionSpec(globe: boolean): ProjectionSpec {
  return globe ? { type: "globe" } : { type: "mercator" };
}
