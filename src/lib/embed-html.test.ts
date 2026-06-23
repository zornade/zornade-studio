import { describe, it, expect } from "vitest";
import { buildEmbedHtml, escapeHtml, EMBED_MAPLIBRE_VERSION, EMBED_PLOT_VERSION, EMBED_SCROLLAMA_VERSION } from "./embed-html";
import { computeBreaks } from "./choropleth";
import type { ChoroplethSpec, PointSpec, GeoSpec, ChartSpec, StorySpec } from "./spec";

function spec(over: Partial<ChoroplethSpec> = {}): ChoroplethSpec {
  return {
    schemaVersion: 1,
    type: "choropleth",
    project: { title: "Arrivi 2024", subtitle: "per regione", source: "ISTAT" },
    geo: { level: "regioni", keyColumn: "Regione", valueColumn: "Arrivi" },
    data: [
      { key: "Lombardia", value: 25794 },
      { key: "Veneto", value: 73890 },
    ],
    design: {
      basemap: "ofm-positron", colorScale: "teal-seq", reverseScale: false,
      classification: "quantile",
      manualBreaks: [], legendType: "steps", nClasses: 5, valueLabel: "",
      valueUnit: "", titleFont: "Inter", showTitle: true, showLegend: true,
      showSource: true, tooltip: true, tooltipTemplate: "", zoomPan: true,
      readerFilters: false, pointColor: "#01646f", pointSize: 7,
    },
    ...over,
  };
}

describe("escapeHtml", () => {
  it("escapes the dangerous characters", () => {
    expect(escapeHtml(`<script>"&'`)).toBe("&lt;script&gt;&quot;&amp;&#39;");
  });
});

describe("buildEmbedHtml", () => {
  const html = buildEmbedHtml(spec(), { geoBaseUrl: "https://embed.x/geo" });

  it("is a complete HTML document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
  });

  it("pins the MapLibre version", () => {
    expect(html).toContain(`maplibre-gl@${EMBED_MAPLIBRE_VERSION}/dist/maplibre-gl.js`);
  });

  it("references the geometry under the given base URL", () => {
    expect(html).toContain("https://embed.x/geo/regioni.geojson");
  });

  it("includes the (normalised) join keys and the title", () => {
    expect(html).toContain("lombardia");
    expect(html).toContain("Arrivi 2024");
  });

  it("always carries the Zornade attribution", () => {
    expect(html).toContain("Fatto con Zornade Studio");
    expect(html).toContain("zornade.com/studio");
  });

  it("escapes a malicious title (no raw script injection)", () => {
    const evil = spec({
      project: {
        title: `</script><script>alert(1)</script>`,
        subtitle: "",
        source: `"><img src=x onerror=alert(2)>`,
      },
    });
    const out = buildEmbedHtml(evil, { geoBaseUrl: "https://embed.x/geo" });
    // The raw injection string must not appear verbatim in HTML context.
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).not.toContain("<img src=x onerror=alert(2)>");
    expect(out).toContain("&lt;script&gt;alert(1)");
  });

  it("does not let injected config break out of the inline <script>", () => {
    const evil = spec({
      design: { ...spec().design, valueLabel: `</script><script>alert(3)</script>` },
    });
    const out = buildEmbedHtml(evil, { geoBaseUrl: "https://embed.x/geo" });
    // The </script> inside the injected JSON must be neutralised to \u003c.
    expect(out).not.toContain("</script><script>alert(3)");
    expect(out).toContain("\\u003c/script");
  });

  it("bakes the SAME breaks the canonical classifier produces (parity)", () => {
    const data = [
      { key: "a", value: 1 }, { key: "b", value: 5 },
      { key: "c", value: 9 }, { key: "d", value: 30 },
    ];
    const out = buildEmbedHtml(
      spec({ data, design: { ...spec().design, classification: "quantile", nClasses: 4 } }),
      { geoBaseUrl: "https://embed.x/geo" },
    );
    const { breaks } = computeBreaks([1, 5, 9, 30], "quantile", 4, []);
    expect(breaks.length).toBeGreaterThan(0);
    for (const b of breaks) expect(out).toContain(String(b));
  });

  it("classifies with the chosen method (jenks) without falling back to quantile", () => {
    const data = [1, 2, 3, 50, 80, 81].map((v, i) => ({
      key: String.fromCharCode(97 + i),
      value: v,
    }));
    const out = buildEmbedHtml(
      spec({ data, design: { ...spec().design, classification: "jenks", nClasses: 3 } }),
      { geoBaseUrl: "https://embed.x/geo" },
    );
    const { breaks } = computeBreaks([1, 2, 3, 50, 80, 81], "jenks", 3, []);
    for (const b of breaks) expect(out).toContain(String(b));
  });

  it("manual classification with no thresholds paints a single solid class", () => {
    const out = buildEmbedHtml(
      spec({ design: { ...spec().design, classification: "manual", manualBreaks: [] } }),
      { geoBaseUrl: "https://embed.x/geo" },
    );
    // A MapLibre `step` with zero stops is invalid, so there must be none.
    expect(out).not.toContain('"step"');
  });

  it("resolves the basemap from the catalog", () => {
    const none = buildEmbedHtml(
      spec({ design: { ...spec().design, basemap: "none" } }),
      { geoBaseUrl: "https://embed.x/geo" },
    );
    expect(none).toContain('"basemapStyle":null');
    const dark = buildEmbedHtml(
      spec({ design: { ...spec().design, basemap: "ofm-dark" } }),
      { geoBaseUrl: "https://embed.x/geo" },
    );
    expect(dark).toContain("tiles.openfreemap.org/styles/dark");
  });

  it("carries the legend flag through to the embed", () => {
    expect(html).toContain('"showLegend":true');
    const off = buildEmbedHtml(
      spec({ design: { ...spec().design, showLegend: false } }),
      { geoBaseUrl: "https://embed.x/geo" },
    );
    expect(off).toContain('"showLegend":false');
  });

  it("renders a styled tooltip matching the editor (name + value, no <strong>)", () => {
    expect(html).toContain('className:"studio-tooltip"');
    expect(html).toContain("studio-tooltip-name");
    expect(html).toContain("studio-tooltip-value");
    expect(html).toContain(".studio-tooltip .maplibregl-popup-tip{display:none}");
  });

  it("uses injected canonical classes instead of recomputing (parity)", () => {
    // Supplying explicit breaks (as the publish path does from real geometry)
    // must win over classifying the raw spec data.
    const out = buildEmbedHtml(spec(), {
      geoBaseUrl: "https://embed.x/geo",
      classes: { breaks: [111, 222], min: 7, max: 999 },
    });
    expect(out).toContain("111");
    expect(out).toContain("222");
    expect(out).toContain('"min":7');
    expect(out).toContain('"max":999');
  });

  it("omits title/source blocks when toggled off", () => {
    const out = buildEmbedHtml(
      spec({ design: { ...spec().design, showTitle: false, showSource: false } }),
      { geoBaseUrl: "https://embed.x/geo" },
    );
    expect(out).not.toContain('<div class="ttl">');
    expect(out).not.toContain('<div class="src">');
  });
});

describe("buildEmbedHtml · temporal (O3.3)", () => {
  const temporalSpec = spec({
    data: [
      { key: "Lombardia", value: 120 },
      { key: "Lazio", value: 60 },
    ],
    time: { column: "periodo", frames: ["2020", "2021"] },
    frames: [
      { period: "2020", data: [{ key: "Lombardia", value: 100 }, { key: "Lazio", value: 50 }] },
      { period: "2021", data: [{ key: "Lombardia", value: 120 }, { key: "Lazio", value: 60 }] },
    ],
  });
  const out = buildEmbedHtml(temporalSpec, { geoBaseUrl: "https://embed.x/geo" });

  it("injects the frames keyed by normalised key, with labels", () => {
    expect(out).toContain('"frames":');
    expect(out).toContain('"label":"2020"');
    expect(out).toContain('"label":"2021"');
    // Normalised keys present in a frame.
    expect(out).toContain("lombardia");
  });

  it("starts on the most recent frame", () => {
    expect(out).toContain('"initialFrame":1');
  });

  it("ships the time-slider data (frames array) that activates the UI", () => {
    // The renderer always defines timeUI(); it activates only when frames exist.
    expect(out).toContain('"frames":[');
    expect(out).toContain("function timeUI(");
  });

  it("classifies over ALL frames so colours are comparable across time", () => {
    // Shared scale spans both frames' values (50…120), not just the newest.
    const { breaks } = computeBreaks([100, 50, 120, 60], "quantile", 5, []);
    for (const b of breaks) expect(out).toContain(String(b));
  });

  it("a non-temporal spec ships no frames (slider stays inert)", () => {
    const plain = buildEmbedHtml(spec(), { geoBaseUrl: "https://embed.x/geo" });
    expect(plain).toContain('"frames":null');
    expect(plain).toContain('"initialFrame":0');
  });
});

describe("buildEmbedHtml · annotations (O3.4)", () => {
  it("inlines area/line annotations as GeoJSON and renders them", () => {
    const out = buildEmbedHtml(
      spec({
        annotations: [
          { id: "ar1", type: "area", shape: "rectangle", a: [12, 42], b: [13, 43], color: "#ff0000", opacity: 0.3 },
          { id: "l1", type: "line", start: [12, 42], end: [13, 43], arrow: true, color: "#00ff00", width: 3 },
        ],
      }),
      { geoBaseUrl: "https://embed.x/geo" },
    );
    expect(out).toContain('"annotGeo":');
    expect(out).toContain('"__color":"#ff0000"');
    expect(out).toContain('"__opacity":0.3');
    expect(out).toContain('function annotations(');
    expect(out).toContain('"annot-fill"');
  });

  it("escapes a malicious marker label (no raw script injection)", () => {
    const out = buildEmbedHtml(
      spec({
        annotations: [
          { id: "m1", type: "marker", lng: 12, lat: 42, label: "<img src=x onerror=alert(1)>", color: "#000000" },
        ],
      }),
      { geoBaseUrl: "https://embed.x/geo" },
    );
    // The label is carried as data (json-escaped) and escaped again at render.
    expect(out).not.toContain("<img src=x onerror=alert(1)>");
    expect(out).toContain('"annotMarkers":');
  });

  it("ships empty annotation collections when there are none", () => {
    const out = buildEmbedHtml(spec(), { geoBaseUrl: "https://embed.x/geo" });
    expect(out).toContain('"annotGeo":{"type":"FeatureCollection","features":[]}');
    expect(out).toContain('"annotMarkers":[]');
  });
});

describe("buildEmbedHtml · accessibility & oEmbed (O3.5)", () => {
  it("inlines a visually-hidden, screen-reader data table", () => {
    const out = buildEmbedHtml(spec(), { geoBaseUrl: "https://embed.x/geo" });
    expect(out).toContain('class="sr-only"');
    expect(out).toContain("<caption>Arrivi 2024</caption>");
    expect(out).toContain('<th scope="col">Regione</th>');
    expect(out).toContain('<th scope="row">Lombardia</th>');
    // The value is IT-formatted (25.794) in the table cell.
    expect(out).toContain("25.794");
  });

  it("escapes table cell content (no injection via data keys)", () => {
    const out = buildEmbedHtml(
      spec({ data: [{ key: "<img src=x onerror=alert(1)>", value: 1 }] }),
      { geoBaseUrl: "https://embed.x/geo" },
    );
    expect(out).not.toContain("<img src=x onerror=alert(1)>");
    expect(out).toContain("&lt;img src=x");
  });

  it("emits oEmbed discovery links when a self URL is given", () => {
    const out = buildEmbedHtml(spec(), {
      geoBaseUrl: "https://embed.x/geo",
      selfUrl: "https://studio.zornade.com/embed/arrivi/abc/",
    });
    expect(out).toContain('type="application/json+oembed"');
    expect(out).toContain('type="text/xml+oembed"');
    expect(out).toContain(
      "https://studio.zornade.com/api/oembed?url=" +
        encodeURIComponent("https://studio.zornade.com/embed/arrivi/abc/") +
        "&amp;format=json",
    );
  });

  it("omits oEmbed links when no self URL is given", () => {
    const out = buildEmbedHtml(spec(), { geoBaseUrl: "https://embed.x/geo" });
    expect(out).not.toContain("+oembed");
  });
});

describe("buildEmbedHtml · area map variants (O4 publish)", () => {
  const base = "https://embed.x/geo";

  it("defaults the render to choropleth in the embed config", () => {
    const out = buildEmbedHtml(spec(), { geoBaseUrl: base });
    expect(out).toContain('"render":"choropleth"');
  });

  it("extrusion ships a fill-extrusion renderer with a pitch", () => {
    const out = buildEmbedHtml(spec({ render: "extrusion" }), { geoBaseUrl: base });
    expect(out).toContain('"render":"extrusion"');
    expect(out).toContain('"pitch":50');
    expect(out).toContain("fill-extrusion");
  });

  it("symbol/spike ship the centroid + marks renderer", () => {
    const out = buildEmbedHtml(spec({ render: "symbol" }), { geoBaseUrl: base });
    expect(out).toContain('"render":"symbol"');
    expect(out).toContain("function centroid(");
    expect(out).toContain("function marks(");
  });

  it("category map carries a category legend + match colours", () => {
    const out = buildEmbedHtml(
      spec({
        render: "category",
        geo: { level: "regioni", keyColumn: "Regione", valueColumn: "", categoryColumn: "Macro" },
        data: [
          { key: "Lombardia", category: "Nord" },
          { key: "Veneto", category: "Nord" },
          { key: "Lazio", category: "Centro" },
        ],
      }),
      { geoBaseUrl: base },
    );
    expect(out).toContain('"render":"category"');
    expect(out).toContain('"categoryLegend"');
    expect(out).toContain("Nord");
    expect(out).toContain("Centro");
  });

  it("bivariate map carries the 3×3 palette and the two raw values", () => {
    const out = buildEmbedHtml(
      spec({
        render: "bivariate",
        data: [
          { key: "Lombardia", value: 10, value2: 100 },
          { key: "Veneto", value: 20, value2: 200 },
          { key: "Lazio", value: 30, value2: 300 },
        ],
      }),
      { geoBaseUrl: base },
    );
    expect(out).toContain('"render":"bivariate"');
    expect(out).toContain('"bivPalette"');
    expect(out).toContain('"bivA"');
    expect(out).toContain('"bivB"');
  });

  it("escapes a malicious category label", () => {
    const out = buildEmbedHtml(
      spec({
        render: "category",
        geo: { level: "regioni", keyColumn: "Regione", valueColumn: "", categoryColumn: "Macro" },
        data: [{ key: "Lombardia", category: "<img src=x onerror=alert(1)>" }],
      }),
      { geoBaseUrl: base },
    );
    expect(out).not.toContain("<img src=x onerror=alert(1)>");
  });

  it("cartogram ships the inline transform + the chosen variant", () => {
    const nc = buildEmbedHtml(spec({ render: "cartogram", cartogramKind: "noncontiguous" }), {
      geoBaseUrl: base,
    });
    expect(nc).toContain('"render":"cartogram"');
    expect(nc).toContain('"cartogramKind":"noncontiguous"');
    expect(nc).toContain("function cartogram(");
    const dor = buildEmbedHtml(spec({ render: "cartogram", cartogramKind: "dorling" }), {
      geoBaseUrl: base,
    });
    expect(dor).toContain('"cartogramKind":"dorling"');
  });
});

describe("buildEmbedHtml · point maps (O4 publish, phase 2)", () => {
  const base = "https://embed.x/geo";

  function pointSpec(over: Partial<PointSpec> = {}): PointSpec {
    return {
      schemaVersion: 1,
      type: "point",
      render: "points",
      project: { title: "Eventi", subtitle: "", source: "Test" },
      points: [
        { lng: 12.5, lat: 41.9, value: 10, category: "A", name: "Roma" },
        { lng: 9.2, lat: 45.5, value: 20, category: "B", name: "Milano" },
        { lng: 14.3, lat: 40.8, value: 30, category: "A", name: "Napoli" },
      ],
      fields: { name: "citta", value: "intensita", category: "categoria" },
      design: {
        basemap: "ofm-positron", colorScale: "teal-seq", reverseScale: false,
        classification: "quantile", manualBreaks: [], legendType: "steps",
        nClasses: 5, valueLabel: "", valueUnit: "", titleFont: "Inter",
        showTitle: true, showLegend: true, showSource: true, tooltip: true,
        tooltipTemplate: "", zoomPan: true, readerFilters: false,
        pointColor: "#01646f", pointSize: 7,
      },
      ...over,
    };
  }

  it("inlines the coordinates and ships a circle layer (no geometry fetch)", () => {
    const out = buildEmbedHtml(pointSpec(), { geoBaseUrl: base });
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain('"render":"points"');
    expect(out).toContain('"layerType":"circle"');
    expect(out).toContain("[12.5,41.9]"); // inline coords
    expect(out).not.toContain("fetch("); // never fetches geometry
  });

  it("locator ships always-on labels", () => {
    const out = buildEmbedHtml(pointSpec({ render: "locator" }), { geoBaseUrl: base });
    expect(out).toContain('"showLabels":true');
    expect(out).toContain('"render":"locator"');
  });

  it("heatmap ships a heatmap layer + no tooltip", () => {
    const out = buildEmbedHtml(pointSpec({ render: "heatmap" }), { geoBaseUrl: base });
    expect(out).toContain('"layerType":"heatmap"');
    expect(out).toContain('"tooltip":false');
  });

  it("hexbin precomputes hexagons + step classes (not raw points)", () => {
    const many: PointSpec["points"] = Array.from({ length: 60 }, (_, i) => ({
      lng: 12.4 + (i % 8) * 0.02,
      lat: 41.8 + Math.floor(i / 8) * 0.02,
    }));
    const out = buildEmbedHtml(pointSpec({ render: "hexbin", points: many }), { geoBaseUrl: base });
    expect(out).toContain('"layerType":"fill"');
    expect(out).toContain('"legendKind":"steps"');
    expect(out).toContain("Polygon"); // hexagons, not just points
  });

  it("category points carry a category legend", () => {
    const out = buildEmbedHtml(pointSpec(), { geoBaseUrl: base });
    expect(out).toContain('"legendKind":"category"');
    expect(out).toContain('"categoryLegend"');
  });

  it("escapes a malicious point name", () => {
    const out = buildEmbedHtml(
      pointSpec({
        points: [{ lng: 12, lat: 42, name: "<img src=x onerror=alert(1)>" }],
      }),
      { geoBaseUrl: base },
    );
    expect(out).not.toContain("<img src=x onerror=alert(1)>");
  });

  it("includes an accessible data table of the points", () => {
    const out = buildEmbedHtml(pointSpec(), { geoBaseUrl: base });
    expect(out).toContain('class="sr-only"');
    expect(out).toContain("Roma");
  });
});

describe("buildEmbedHtml · custom geometry (O4 publish, phase 3)", () => {
  const base = "https://embed.x/geo";

  function geoSpec(over: Partial<GeoSpec> = {}): GeoSpec {
    return {
      schemaVersion: 1,
      type: "geo",
      project: { title: "Zone", subtitle: "", source: "Test" },
      geojson: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { __value: 100, __name: "Zona A" },
            geometry: { type: "Polygon", coordinates: [[[12, 41], [13, 41], [13, 42], [12, 41]]] },
          },
          {
            type: "Feature",
            properties: { __value: 200, __name: "Zona B" },
            geometry: { type: "Polygon", coordinates: [[[9, 45], [10, 45], [10, 46], [9, 45]]] },
          },
        ],
      },
      geometryKinds: ["polygon"],
      hasValue: true,
      hasCategory: false,
      categories: [],
      valueLabel: "Popolazione",
      design: {
        basemap: "ofm-positron", colorScale: "teal-seq", reverseScale: false,
        classification: "quantile", manualBreaks: [], legendType: "steps",
        nClasses: 5, valueLabel: "Popolazione", valueUnit: "", titleFont: "Inter",
        showTitle: true, showLegend: true, showSource: true, tooltip: true,
        tooltipTemplate: "", zoomPan: true, readerFilters: false,
        pointColor: "#01646f", pointSize: 7,
      },
      ...over,
    };
  }

  it("inlines the user's geometry and draws fill/line/point layers (no fetch)", () => {
    const out = buildEmbedHtml(geoSpec(), { geoBaseUrl: base });
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain('"geometryKinds":["polygon"]');
    expect(out).toContain("d-fill");
    expect(out).toContain("d-point");
    expect(out).not.toContain("fetch(");
  });

  it("uses a graduated step legend when features carry a value", () => {
    const out = buildEmbedHtml(geoSpec(), { geoBaseUrl: base });
    expect(out).toContain('"legendKind":"steps"');
  });

  it("uses a category legend when there is no value", () => {
    const out = buildEmbedHtml(
      geoSpec({
        hasValue: false,
        hasCategory: true,
        categories: ["residenziale", "industriale"],
      }),
      { geoBaseUrl: base },
    );
    expect(out).toContain('"legendKind":"category"');
    expect(out).toContain("residenziale");
  });

  it("escapes a malicious feature name in the accessible table", () => {
    const out = buildEmbedHtml(
      geoSpec({
        geojson: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: { __value: 1, __name: "<img src=x onerror=alert(1)>" },
              geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
            },
          ],
        },
      }),
      { geoBaseUrl: base },
    );
    expect(out).not.toContain("<img src=x onerror=alert(1)>");
  });
});

describe("buildEmbedHtml · charts (O4 publish, phase 4)", () => {
  const base = "https://embed.x/geo";

  function chartSpec(over: Partial<ChartSpec> = {}): ChartSpec {
    return {
      schemaVersion: 1,
      type: "chart",
      render: "bar",
      project: { title: "Serie", subtitle: "", source: "Test" },
      points: [
        { x: "2020", y: 10 },
        { x: "2021", y: 20 },
      ],
      hasSeries: false,
      axisX: "anno",
      axisY: "valore",
      colors: ["#aee", "#0a7", "#016"],
      design: {
        basemap: "ofm-positron", colorScale: "teal-seq", reverseScale: false,
        classification: "quantile", manualBreaks: [], legendType: "steps",
        nClasses: 5, valueLabel: "", valueUnit: "", titleFont: "Inter",
        showTitle: true, showLegend: true, showSource: true, tooltip: true,
        tooltipTemplate: "", zoomPan: true, readerFilters: false,
        pointColor: "#01646f", pointSize: 7,
      },
      ...over,
    };
  }

  it("loads Observable Plot from the pinned CDN and inlines the points", () => {
    const out = buildEmbedHtml(chartSpec(), { geoBaseUrl: base });
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain(`@observablehq/plot@${EMBED_PLOT_VERSION}`);
    expect(out).toContain('"render":"bar"');
    expect(out).toContain('"axisX":"anno"');
    expect(out).not.toContain("maplibre"); // charts are not maps
  });

  it("renders a table when render is table", () => {
    const out = buildEmbedHtml(
      chartSpec({
        render: "table",
        points: undefined,
        table: { columns: ["anno", "valore"], rows: [{ anno: "2020", valore: "10" }] },
      }),
      { geoBaseUrl: base },
    );
    expect(out).toContain('"render":"table"');
    expect(out).toContain("anno");
    expect(out).toContain('class="sr-only"');
  });

  it("ships a visually-hidden data table for charts", () => {
    const out = buildEmbedHtml(chartSpec(), { geoBaseUrl: base });
    expect(out).toContain('class="sr-only"');
    expect(out).toContain("anno");
  });

  it("escapes malicious table content", () => {
    const out = buildEmbedHtml(
      chartSpec({
        render: "table",
        points: undefined,
        table: { columns: ["x"], rows: [{ x: "<img src=x onerror=alert(1)>" }] },
      }),
      { geoBaseUrl: base },
    );
    expect(out).not.toContain("<img src=x onerror=alert(1)>");
  });
});



describe("buildEmbedHtml · scrollytelling story (O4.1)", () => {
  const base = "https://embed.x/geo";

  function storySpec(over: Partial<StorySpec> = {}): StorySpec {
    const baseMap = spec();
    return {
      schemaVersion: 1,
      type: "story",
      project: { title: "La storia", subtitle: "scroll", source: "Test" },
      base: baseMap,
      steps: [
        { id: "a", title: "Primo", body: "Testo uno", camera: { center: [12, 42], zoom: 5, pitch: 0, bearing: 0 } },
        { id: "b", title: "Secondo", body: "Testo due", camera: { center: [9, 45], zoom: 7, pitch: 30, bearing: 10 } },
      ],
      design: baseMap.design,
      ...over,
    };
  }

  it("loads Scrollama from the pinned CDN and inlines the cameras", () => {
    const out = buildEmbedHtml(storySpec(), { geoBaseUrl: base });
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain(`scrollama@${EMBED_SCROLLAMA_VERSION}`);
    expect(out).toContain('"cameras"');
    expect(out).toContain('id="mapframe"');
  });

  it("hosts the base map inside an iframe srcdoc and exposes its map", () => {
    const out = buildEmbedHtml(storySpec(), { geoBaseUrl: base });
    expect(out).toContain("srcdoc=");
    // the base map's renderer is escaped into the srcdoc, with the global hook.
    expect(out).toContain("window.__zmap");
  });

  it("renders the step text (escaped)", () => {
    const out = buildEmbedHtml(storySpec(), { geoBaseUrl: base });
    expect(out).toContain("Primo");
    expect(out).toContain("Testo due");
  });

  it("escapes a malicious step title", () => {
    const out = buildEmbedHtml(
      storySpec({
        steps: [
          { id: "x", title: "<img src=x onerror=alert(1)>", body: "", camera: { center: [12, 42], zoom: 5, pitch: 0, bearing: 0 } },
        ],
      }),
      { geoBaseUrl: base },
    );
    expect(out).not.toContain("<img src=x onerror=alert(1)>");
  });
});
