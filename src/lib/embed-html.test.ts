import { describe, it, expect } from "vitest";
import { buildEmbedHtml, escapeHtml, EMBED_MAPLIBRE_VERSION } from "./embed-html";
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

  it("includes the spec data and title", () => {
    expect(html).toContain("Lombardia");
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

  it("does not let spec data break out of the inline <script>", () => {
    const evil = spec({
      data: [{ key: "</script><script>alert(3)</script>", value: 1 }],
    });
    const out = buildEmbedHtml(evil, { geoBaseUrl: "https://embed.x/geo" });
    // The </script> inside the JSON must be neutralised to \u003c.
    expect(out).not.toContain("</script><script>alert(3)");
    expect(out).toContain("\\u003c/script");
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
