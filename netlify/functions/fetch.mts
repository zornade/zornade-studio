/**
 * GET /api/fetch?url=<resource-url>
 *
 * Server-side proxy that downloads a single open-data resource (CSV/JSON/…)
 * and streams it back to the browser. This lets the Studio load resources from
 * portals that do not send CORS headers on their files.
 *
 * SECURITY (SSRF mitigation): the target is constrained - only http/https,
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
      // Keep this safely BELOW Netlify's synchronous-function execution limit
      // (~10s). A longer timeout is pointless: the platform would kill the
      // function first and return an opaque 502 with no JSON body - which the
      // client could only show as a generic "Download fallito". Failing fast
      // here lets us return a clear, actionable error instead.
      signal: AbortSignal.timeout(8500),
    });
  } catch (e) {
    // Distinguish the common real-world failures so the user knows what to do.
    const name = e instanceof Error ? e.name : "";
    const code = (e as { cause?: { code?: string } } | undefined)?.cause?.code;
    if (name === "TimeoutError" || name === "AbortError") {
      return json(
        { error: "La sorgente è troppo lenta a rispondere (timeout). Riprova o usa “Apri la fonte”." },
        504,
      );
    }
    if (code && /CERT|SSL|TLS|DEPTH_ZERO|SELF_SIGNED/i.test(code)) {
      return json(
        { error: "La sorgente ha un certificato HTTPS non valido: scaricala da “Apri la fonte”." },
        502,
      );
    }
    return json(
      { error: "Impossibile raggiungere la sorgente (server non disponibile)." },
      502,
    );
  }
  if (!upstream.ok) {
    // A 404/410/403 from the source is not a gateway failure: report it as
    // "resource unavailable" so the user understands the link is dead/blocked,
    // rather than a misleading 502.
    if ([401, 403, 404, 410].includes(upstream.status)) {
      return json(
        { error: `La risorsa non è più disponibile alla fonte (${upstream.status}).` },
        404,
      );
    }
    return json({ error: `La sorgente ha risposto con un errore (${upstream.status}).` }, 502);
  }

  const ct = upstream.headers.get("content-type") ?? "application/octet-stream";
  if (!ALLOWED_CT.test(ct)) {
    // Frequently the resource URL points to an HTML landing page, not the file.
    return json(
      {
        error:
          "Il link non punta a un file di dati ma a una pagina web: apri la fonte e scarica il file diretto (CSV/JSON).",
      },
      415,
    );
  }
  const len = Number(upstream.headers.get("content-length") ?? "0");
  if (len > MAX_BYTES) return json({ error: "File troppo grande." }, 413);

  // The fetch abort signal also covers body streaming, so a slow/huge download
  // aborts here rather than letting the platform kill the function with an
  // opaque 502. Catch it and report a clear, actionable timeout.
  let buf: ArrayBuffer;
  try {
    buf = await upstream.arrayBuffer();
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return json(
        { error: "Il file è troppo lento/grande da scaricare entro il limite. Usa “Apri la fonte”." },
        504,
      );
    }
    return json({ error: "Download interrotto dalla sorgente." }, 502);
  }
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
