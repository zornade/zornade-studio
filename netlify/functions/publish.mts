/**
 * POST /api/publish  { spec }
 *
 * Auth-gated publishing endpoint (O1.5). Takes a choropleth spec, validates it,
 * generates the self-contained embed HTML, and uploads both the spec and the
 * embed to DigitalOcean Spaces under a **content-addressed, immutable** key
 * (`embed/{slug}/{hash}/…`). Returns the public embed URL.
 *
 * The embed is served to readers through the Netlify proxy
 * (`studio.zornade.com/embed/* → Spaces CDN`, see netlify.toml), so it always
 * sits behind a Zornade domain — storage can later move to self-hosted Garage
 * without breaking any published embed.
 *
 * Required environment variables (Netlify → Site settings → Environment):
 *   SPACES_KEY, SPACES_SECRET   Spaces access keys (Spaces Access Keys page)
 *   SPACES_BUCKET               e.g. "zornade-studio-embed"
 *   SPACES_REGION               e.g. "fra1"
 *   STUDIO_SESSION_SECRET       (existing) to verify the auth cookie
 * Optional:
 *   EMBED_BASE_URL              public origin, default https://studio.zornade.com
 *   EMBED_GEO_BASE              geometry base, default https://studio.zornade.com/geo
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { verifyToken, readCookie } from "./_session.mts";
import { isChoroplethSpec, type ChoroplethSpec } from "../../src/lib/spec";
import { buildEmbedHtml } from "../../src/lib/embed-html";
import { publishKeys } from "../../src/lib/publish-key";

const DEFAULT_BASE = "https://studio.zornade.com";
const DEFAULT_GEO = "https://studio.zornade.com/geo";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // 1. Auth — same signed-cookie scheme as the other functions.
  const secret = process.env.STUDIO_SESSION_SECRET;
  if (!secret) return json({ error: "Auth non configurata." }, 500);
  const token = readCookie(req.headers.get("cookie"));
  if (!token || !verifyToken(token, secret)) {
    return json({ error: "Non autenticato." }, 401);
  }

  // 2. Storage config.
  const key = process.env.SPACES_KEY;
  const accessSecret = process.env.SPACES_SECRET;
  const bucket = process.env.SPACES_BUCKET;
  const region = process.env.SPACES_REGION;
  if (!key || !accessSecret || !bucket || !region) {
    const missing = [
      !key && "SPACES_KEY",
      !accessSecret && "SPACES_SECRET",
      !bucket && "SPACES_BUCKET",
      !region && "SPACES_REGION",
    ].filter(Boolean);
    return json({ error: `Storage non configurato: ${missing.join(", ")}.` }, 500);
  }
  const baseUrl = (process.env.EMBED_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
  const geoBase = (process.env.EMBED_GEO_BASE ?? DEFAULT_GEO).replace(/\/$/, "");

  // 3. Parse + validate the spec.
  let spec: ChoroplethSpec;
  try {
    const body = (await req.json()) as { spec?: unknown };
    if (!isChoroplethSpec(body.spec)) {
      return json({ error: "Spec non valida o tipo non supportato." }, 400);
    }
    spec = body.spec;
  } catch {
    return json({ error: "Corpo della richiesta non valido." }, 400);
  }

  // 4. Build artefacts. The public URL targets the actual index.html object —
  // the Spaces CDN does not auto-resolve a directory index for a trailing slash.
  const keys = publishKeys(spec);
  const selfUrl = `${baseUrl}/${keys.embed}`;
  const html = buildEmbedHtml(spec, { geoBaseUrl: geoBase, selfUrl });

  // 5. Upload to Spaces (S3-compatible). Immutable, cacheable, public-read.
  const client = new S3Client({
    endpoint: `https://${region}.digitaloceanspaces.com`,
    region: "us-east-1", // required by the SDK; real region is in the endpoint
    forcePathStyle: false,
    credentials: { accessKeyId: key, secretAccessKey: accessSecret },
  });
  const immutable = "public, max-age=31536000, immutable";
  try {
    await Promise.all([
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: keys.embed,
          Body: html,
          ContentType: "text/html; charset=utf-8",
          CacheControl: immutable,
          ACL: "public-read",
        }),
      ),
      client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: keys.spec,
          Body: JSON.stringify(spec),
          ContentType: "application/json; charset=utf-8",
          CacheControl: immutable,
          ACL: "public-read",
        }),
      ),
    ]);
  } catch (e) {
    return json(
      { error: `Caricamento su storage fallito: ${e instanceof Error ? e.message : "errore"}.` },
      502,
    );
  }

  return json({ url: selfUrl, prefix: keys.prefix });
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const config = { path: "/api/publish" };
