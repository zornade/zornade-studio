/**
 * GET /api/oembed?url=<embed-url>&format=json|xml&maxwidth=&maxheight=
 *
 * Public oEmbed provider endpoint (O3.5). WordPress and other consumers call
 * this (after discovering it via the `<link rel="alternate" …+oembed">` tags in
 * a published snapshot) to turn a pasted Zornade Studio URL into an embedded
 * iframe.
 *
 * Security: the `url` must be one of OUR embeds (allowed origin + `/embed/`
 * path) — this keeps the endpoint from being used as an open proxy. The title
 * is read from the embed page's own `<title>` (same origin we just validated).
 *
 * Optional environment variables:
 *   EMBED_BASE_URL   public embed origin, default https://studio.zornade.com
 */

import {
  isAllowedEmbedUrl,
  buildOembedResponse,
} from "../../src/lib/oembed";

const DEFAULT_BASE = "https://studio.zornade.com";

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const target = url.searchParams.get("url");
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();

  if (!target) return text("Missing 'url' parameter.", 400);
  if (format !== "json" && format !== "xml") {
    // oEmbed spec: 501 for an unsupported requested format.
    return text("Unsupported format.", 501);
  }

  const base = (process.env.EMBED_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
  const allowed = [originOf(base)].filter(Boolean) as string[];
  if (!isAllowedEmbedUrl(target, allowed)) {
    // oEmbed spec: 404 when no embed can be produced for the URL.
    return text("No oEmbed available for this URL.", 404);
  }

  const maxwidth = toInt(url.searchParams.get("maxwidth"));
  const maxheight = toInt(url.searchParams.get("maxheight"));
  const title = await fetchTitle(target);

  const { contentType, body } = buildOembedResponse({
    url: target,
    title,
    format,
    maxwidth,
    maxheight,
  });

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": contentType,
      // oEmbed consumers fetch cross-origin; allow it and cache briefly.
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=600",
    },
  });
};

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function originOf(u: string): string | null {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

function toInt(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Read the embed page's <title>; safe because the URL was already validated as
 * our own origin. Falls back to a generic title on any failure. */
async function fetchTitle(target: string): Promise<string> {
  const fallback = "Mappa di Zornade";
  try {
    const res = await fetch(target, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return fallback;
    const html = await res.text();
    const m = html.match(/<title>([\s\S]*?)<\/title>/i);
    if (!m) return fallback;
    return decodeEntities(m[1].trim()) || fallback;
  } catch {
    return fallback;
  }
}

/** Decode the handful of entities the embed escapes its title with. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export const config = { path: "/api/oembed" };
