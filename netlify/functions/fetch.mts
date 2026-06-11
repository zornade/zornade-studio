/**
 * GET /api/fetch?url=<resource-url>
 *
 * Server-side proxy that downloads a single open-data resource (CSV/JSON/…)
 * and streams it back to the browser. This lets the Studio load resources from
 * portals that do not send CORS headers on their files.
 *
 * SECURITY (SSRF mitigation): the target is constrained — only http/https,
 * only datasets-looking content types, a hard size cap, a timeout, and the
 * hostname must NOT resolve to a private / loopback / link-local address. This
 * prevents using the proxy to reach internal infrastructure.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB cap
const ALLOWED_CT =
  /(text\/csv|text\/plain|application\/json|application\/geo\+json|application\/vnd\.ms-excel|application\/vnd\.openxmlformats|application\/octet-stream|application\/zip|text\/tab-separated-values)/i;

/** True if an IPv4/IPv6 string is in a private / reserved / loopback range. */
function isPrivateAddr(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return (
      v === "::1" ||
      v.startsWith("fc") ||
      v.startsWith("fd") ||
      v.startsWith("fe80") ||
      v === "::"
    );
  }
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

export default async (req: Request): Promise<Response> => {
  const raw = new URL(req.url).searchParams.get("url");
  if (!raw) return json({ error: "Parametro url mancante." }, 400);

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return json({ error: "URL non valido." }, 400);
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return json({ error: "Protocollo non consentito." }, 400);
  }

  // Resolve the hostname and reject private / internal targets.
  try {
    const addrs = await lookup(target.hostname, { all: true });
    if (addrs.length === 0 || addrs.some((a) => isPrivateAddr(a.address))) {
      return json({ error: "Host non consentito." }, 400);
    }
  } catch {
    return json({ error: "Host non risolvibile." }, 400);
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: { "user-agent": "ZornadeStudio/1.0", accept: "*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
  } catch {
    return json({ error: "Download fallito." }, 502);
  }
  if (!upstream.ok) return json({ error: `Sorgente ${upstream.status}.` }, 502);

  const ct = upstream.headers.get("content-type") ?? "application/octet-stream";
  if (!ALLOWED_CT.test(ct)) {
    return json({ error: `Tipo non supportato: ${ct}.` }, 415);
  }
  const len = Number(upstream.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) return json({ error: "File troppo grande." }, 413);

  const buf = await upstream.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return json({ error: "File troppo grande." }, 413);

  return new Response(buf, {
    status: 200,
    headers: {
      "content-type": ct,
      "cache-control": "public, max-age=300",
    },
  });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const config = { path: "/api/fetch" };
