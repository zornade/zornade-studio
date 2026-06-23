import { describe, it, expect } from "vitest";
import {
  isAllowedEmbedUrl,
  oembedIframeHtml,
  buildOembedResponse,
} from "./oembed";

const ORIGINS = ["https://studio.zornade.com"];

describe("isAllowedEmbedUrl", () => {
  it("accepts an embed URL on an allowed origin", () => {
    expect(
      isAllowedEmbedUrl("https://studio.zornade.com/embed/mappa/abc/", ORIGINS),
    ).toBe(true);
  });

  it("rejects other origins (SSRF guard)", () => {
    expect(
      isAllowedEmbedUrl("https://evil.example.com/embed/x/", ORIGINS),
    ).toBe(false);
  });

  it("rejects non-embed paths on an allowed origin", () => {
    expect(
      isAllowedEmbedUrl("https://studio.zornade.com/api/secret", ORIGINS),
    ).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isAllowedEmbedUrl("not a url", ORIGINS)).toBe(false);
  });
});

describe("oembedIframeHtml", () => {
  it("builds an iframe with the URL, dimensions and an escaped title", () => {
    const html = oembedIframeHtml(
      "https://studio.zornade.com/embed/x/",
      'Prezzi "OMI" <Roma>',
      600,
      520,
    );
    expect(html).toContain('src="https://studio.zornade.com/embed/x/"');
    expect(html).toContain('width="600"');
    expect(html).toContain('height="520"');
    expect(html).toContain("Prezzi &quot;OMI&quot; &lt;Roma&gt;");
    expect(html).not.toContain("<Roma>");
  });
});

describe("buildOembedResponse", () => {
  it("returns a spec-compliant rich JSON response by default", () => {
    const { contentType, body } = buildOembedResponse({
      url: "https://studio.zornade.com/embed/x/",
      title: "Prezzi OMI",
    });
    expect(contentType).toContain("application/json");
    const obj = JSON.parse(body);
    expect(obj.type).toBe("rich");
    expect(obj.version).toBe("1.0");
    expect(obj.title).toBe("Prezzi OMI");
    expect(obj.provider_name).toBe("Zornade Studio");
    expect(obj.width).toBe(600);
    expect(obj.height).toBe(520);
    expect(obj.html).toContain("<iframe");
  });

  it("clamps requested dimensions to the bounds", () => {
    const { body } = buildOembedResponse({
      url: "https://studio.zornade.com/embed/x/",
      title: "x",
      maxwidth: 99999,
      maxheight: 300,
    });
    const obj = JSON.parse(body);
    expect(obj.width).toBe(2000);
    expect(obj.height).toBe(300);
  });

  it("produces valid XML when requested", () => {
    const { contentType, body } = buildOembedResponse({
      url: "https://studio.zornade.com/embed/x/",
      title: "Prezzi & Co",
      format: "xml",
    });
    expect(contentType).toContain("text/xml");
    expect(body).toContain('<?xml version="1.0"');
    expect(body).toContain("<type>rich</type>");
    expect(body).toContain("Prezzi &amp; Co");
    expect(body).toContain("&lt;iframe");
  });
});
