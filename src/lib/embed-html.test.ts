import { describe, it, expect } from "vitest";
import { buildEmbedHtml, escapeHtml, EMBED_MAPLIBRE_VERSION } from "./embed-html";
import { computeBreaks } from "./choropleth";
import type { ChoroplethSpec } from "./spec";

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
      basemap: "ofm-positron", colorScale: "teal-seq", classification: "quantile",
      manualBreaks: [], legendType: "steps", nClasses: 5, valueLabel: "",
      valueUnit: "", titleFont: "Inter", showTitle: true, showLegend: true,
      showSource: true, tooltip: true, zoomPan: true,
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
