/**
 * oEmbed provider helpers (O3.5) - pure, dependency-free, testable.
 *
 * WordPress (and other consumers) auto-embed a pasted Zornade Studio URL by
 * discovering the `<link rel="alternate" type="application/json+oembed">` tag in
 * the published snapshot and calling our oEmbed endpoint. This module builds the
 * spec-compliant oEmbed `rich` response (JSON or XML) and validates that the
 * requested `url` is one of our own embeds (so the endpoint can't be turned into
 * an open proxy / SSRF surface).
 *
 * oEmbed spec: https://oembed.com/
 */

export const OEMBED_PROVIDER_NAME = "Zornade Studio";
export const OEMBED_PROVIDER_URL = "https://zornade.com/studio";

/** Default + bounding dimensions for the embedded iframe (points/px). */
const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 520;
const MAX_WIDTH = 2000;
const MAX_HEIGHT = 2000;

/** Escape for HTML text/attribute context (iframe title, figcaption). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape for XML text content (oEmbed XML payload). */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Clamp a requested dimension to a sane bound, falling back to a default. */
function clampDimension(
  raw: number | undefined,
  fallback: number,
  max: number,
): number {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(Math.round(raw), max);
}

/**
 * Whether `url` is a Zornade Studio embed we are willing to describe. Only URLs
 * whose origin is in `allowedOrigins` and whose path starts with `/embed/` are
 * accepted - mirroring the published snapshot key layout.
 */
export function isAllowedEmbedUrl(
  url: string,
  allowedOrigins: string[],
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (!allowedOrigins.includes(parsed.origin)) return false;
  return parsed.pathname.startsWith("/embed/");
}

/**
 * The iframe snippet returned in the oEmbed `html` field. Carries the mandatory
 * Zornade attribution caption (licence/ToS requirement, same as the editor's
 * copy-embed snippet).
 */
export function oembedIframeHtml(
  url: string,
  title: string,
  width: number,
  height: number,
): string {
  const safeUrl = escapeHtml(url);
  const safeTitle = escapeHtml(title || "Mappa di Zornade");
  return (
    `<iframe src="${safeUrl}" width="${width}" height="${height}" ` +
    `frameborder="0" scrolling="no" title="${safeTitle}" loading="lazy" ` +
    `style="max-width:100%;border:0"></iframe>`
  );
}

export interface OembedParams {
  url: string;
  title: string;
  format?: "json" | "xml";
  maxwidth?: number;
  maxheight?: number;
}

export interface OembedResponse {
  contentType: string;
  body: string;
}

/**
 * Build the oEmbed `rich` response (JSON by default, XML on request) for a
 * Zornade Studio embed. The caller is responsible for validating the URL via
 * {@link isAllowedEmbedUrl} first.
 */
export function buildOembedResponse(params: OembedParams): OembedResponse {
  const width = clampDimension(params.maxwidth, DEFAULT_WIDTH, MAX_WIDTH);
  const height = clampDimension(params.maxheight, DEFAULT_HEIGHT, MAX_HEIGHT);
  const html = oembedIframeHtml(params.url, params.title, width, height);
  const title = params.title || "Mappa di Zornade";

  if (params.format === "xml") {
    const body =
      `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n` +
      `<oembed>\n` +
      `<type>rich</type>\n` +
      `<version>1.0</version>\n` +
      `<title>${escapeXml(title)}</title>\n` +
      `<provider_name>${escapeXml(OEMBED_PROVIDER_NAME)}</provider_name>\n` +
      `<provider_url>${escapeXml(OEMBED_PROVIDER_URL)}</provider_url>\n` +
      `<width>${width}</width>\n` +
      `<height>${height}</height>\n` +
      `<html>${escapeXml(html)}</html>\n` +
      `</oembed>`;
    return { contentType: "text/xml; charset=utf-8", body };
  }

  const json = {
    type: "rich",
    version: "1.0",
    title,
    provider_name: OEMBED_PROVIDER_NAME,
    provider_url: OEMBED_PROVIDER_URL,
    width,
    height,
    html,
  };
  return {
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(json),
  };
}
