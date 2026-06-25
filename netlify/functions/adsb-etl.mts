/**
 * POST /api/adsb-etl  { date, bbox, from, to, minPoints?, noMilitary? }
 *
 * Background function (Netlify, timeout 15 min). Con `config.background = true`
 * Netlify invia il 202 al client AUTOMATICAMENTE prima che il body esegua.
 * NON usare return/async-IIFE: tutto il lavoro va fatto nel body direttamente.
 *
 * Flusso:
 *  1. Parse params (prima dell'auth: serve per scrivere errori al jobId)
 *  2. Resolve S3 credentials
 *  3. Auth check (scrive error status su S3 se fallisce)
 *  4. Idempotency: se status=done gia' esiste, esce
 *  5. Scrive status "running" su S3
 *  6. ETL: stream tar -> parse traiettorie -> GeoJSON su S3
 *  7. Scrive status "done" (o "error") su S3
 *
 * Il jobId e' deterministico (stessa logica di adsbJobId() in DataPanel.tsx).
 * Il client fa polling su /embed/adsb/{jobId}.status.json (proxy Netlify -> Spaces).
 *
 * Env vars (stesse di publish.mts):
 *   SPACES_KEY, SPACES_SECRET, SPACES_BUCKET, SPACES_REGION
 *   STUDIO_SESSION_SECRET
 */

import { gunzipSync } from "node:zlib";
import { PassThrough } from "node:stream";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { extract as tarExtract } from "tar-stream";
import { verifyToken, readCookie } from "./_session.mts";

// -- Bounding box (lat_min, lat_max, lon_min, lon_max) ------------------------
const BBOXES: Record<string, [number, number, number, number]> = {
  italy:         [36.0,  47.5,   6.0,  18.5],
  europe:        [35.0,  72.0, -10.0,  35.0],
  france:        [41.0,  51.5,  -5.5,   9.5],
  germany:       [47.0,  55.5,   5.5,  15.5],
  spain:         [35.5,  44.0,  -9.5,   4.5],
  uk:            [49.5,  61.0,  -8.5,   2.5],
  balkans:       [39.0,  47.5,  13.0,  28.0],
  mediterranean: [30.0,  48.0,  -5.0,  37.0],
  alps:          [43.5,  48.5,   5.0,  16.0],
  sicily:        [36.5,  38.5,  12.0,  15.5],
};

// Colonne trace array readsb (verificate su dati reali)
const I_DT = 0, I_LAT = 1, I_LON = 2, I_ALT = 3, I_GS = 4, I_TRACK = 5,
              I_EXTRA = 8;

// -- Helpers S3 ---------------------------------------------------------------
function makeS3(key: string, secret: string, region: string): S3Client {
  return new S3Client({
    endpoint: `https://${region}.digitaloceanspaces.com`,
    region: "us-east-1",
    forcePathStyle: false,
    credentials: { accessKeyId: key, secretAccessKey: secret },
  });
}

async function putJson(
  s3: S3Client,
  bucket: string,
  objKey: string,
  data: unknown,
  contentType = "application/json",
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objKey,
      Body: JSON.stringify(data),
      ContentType: contentType,
      CacheControl: "no-cache, no-store",
      ACL: "public-read",
    }),
  );
}

/** JobId deterministico -- stessa logica di adsbJobId() in DataPanel.tsx. */
export function makeJobId(
  bbox: string,
  date: string,
  from: string,
  to: string,
  noMilitary: boolean,
): string {
  const f = from.replace(":", "");
  const t = to.replace(":", "");
  const mil = noMilitary ? "-nomil" : "";
  return `adsb-${bbox}-${date}-${f}-${t}${mil}`;
}

// -- Resolve URL tar dalla PREFERRED_RELEASES.txt -----------------------------
async function resolveTarUrls(date: string): Promise<string[]> {
  const year = date.slice(0, 4);
  const tagDate = date.replace(/-/g, ".");
  const url =
    `https://raw.githubusercontent.com/adsblol/globe_history_${year}` +
    "/main/PREFERRED_RELEASES.txt";
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (resp.status === 404)
    throw new Error(`Repository globe_history_${year} non trovato.`);
  if (!resp.ok) throw new Error(`PREFERRED_RELEASES.txt HTTP ${resp.status}`);
  const text = await resp.text();
  for (const line of text.split("\n")) {
    if (line.includes(tagDate)) {
      return line.split(",").map((u) => u.trim()).filter(Boolean);
    }
  }
  throw new Error(
    `Nessuna release per ${date}. ` +
    "I dati sono disponibili ~3 ore dopo la mezzanotte UTC del giorno seguente.",
  );
}

// -- Parser singola traccia ---------------------------------------------------
interface GeoFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "LineString"; coordinates: number[][] };
}

function inBbox(
  lat: number,
  lon: number,
  bbox: [number, number, number, number],
): boolean {
  const [latMin, latMax, lonMin, lonMax] = bbox;
  return lat >= latMin && lat <= latMax && lon >= lonMin && lon <= lonMax;
}

function parseTrace(
  rawBytes: Buffer,
  bbox: [number, number, number, number],
  tFrom: number,
  tTo: number,
  minPoints: number,
  noMilitary: boolean,
): GeoFeature | null {
  let data: Buffer;
  try {
    data = gunzipSync(rawBytes);
  } catch {
    return null;
  }

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(data.toString("utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  const icao = (obj.icao as string) ?? "";
  const reg = (obj.r as string) ?? "";
  const aType = (obj.t as string) ?? "";
  const dbFlags = Number(obj.dbFlags ?? 0);
  const tsBase = Number(obj.timestamp ?? 0);
  const trace = Array.isArray(obj.trace) ? (obj.trace as unknown[][]) : [];

  if (!trace.length) return null;

  const isMilitary = Boolean(dbFlags & 1);
  if (noMilitary && isMilitary) return null;

  let flight = "";
  for (const entry of trace) {
    const extra = entry[I_EXTRA];
    if (extra && typeof extra === "object" && !Array.isArray(extra)) {
      const f = (extra as Record<string, unknown>).flight;
      if (typeof f === "string" && f.trim()) {
        flight = f.trim();
        break;
      }
    }
  }

  const coords: number[][] = [];
  const timestamps: number[] = [];
  const alts: (number | null)[] = [];
  const tracks: (number | null)[] = [];
  const gsVals: (number | null)[] = [];
  let hasEmergency = false;

  for (const entry of trace) {
    if (entry.length < 3) continue;
    const lat = entry[I_LAT];
    const lon = entry[I_LON];
    if (lat == null || lon == null) continue;

    const tAbs = tsBase + Number(entry[I_DT]);
    if (tAbs < tFrom || tAbs > tTo) continue;
    if (!inBbox(Number(lat), Number(lon), bbox)) continue;

    const altRaw = entry.length > I_ALT ? entry[I_ALT] : null;
    const alt: number | null =
      altRaw === "ground" ? 0 : typeof altRaw === "number" ? altRaw : null;

    const gsRaw = entry.length > I_GS ? entry[I_GS] : null;
    const gs: number | null = typeof gsRaw === "number" ? gsRaw : null;

    const trackRaw = entry.length > I_TRACK ? entry[I_TRACK] : null;
    const track: number | null = typeof trackRaw === "number" ? trackRaw : null;

    if (!hasEmergency) {
      const extra = entry.length > I_EXTRA ? entry[I_EXTRA] : null;
      if (extra && typeof extra === "object" && !Array.isArray(extra)) {
        const emerg = (extra as Record<string, unknown>).emergency;
        if (emerg && emerg !== "none") hasEmergency = true;
      }
    }

    coords.push([
      Math.round(Number(lon) * 1e5) / 1e5,
      Math.round(Number(lat) * 1e5) / 1e5,
    ]);
    timestamps.push(Math.round(tAbs * 10) / 10);
    alts.push(alt != null ? Math.round(alt) : null);
    tracks.push(track != null ? Math.round(track * 10) / 10 : null);
    gsVals.push(gs != null ? Math.round(gs * 10) / 10 : null);
  }

  if (coords.length < minPoints) return null;

  const altNums = alts.filter((a): a is number => a != null);
  const gsNums = gsVals.filter((g): g is number => g != null);
  const durationS =
    timestamps.length > 1
      ? Math.round(timestamps[timestamps.length - 1] - timestamps[0])
      : 0;

  return {
    type: "Feature",
    properties: {
      icao, r: reg, t: aType, flight, dbFlags,
      is_military: isMilitary,
      is_emergency: hasEmergency,
      n_points: coords.length,
      duration_s: durationS,
      t_start: Math.round(timestamps[0]),
      t_end: Math.round(timestamps[timestamps.length - 1]),
      alt_min_ft: altNums.length ? Math.min(...altNums) : null,
      alt_max_ft: altNums.length ? Math.max(...altNums) : null,
      gs_avg_kts: gsNums.length
        ? Math.round(gsNums.reduce((a, b) => a + b, 0) / gsNums.length)
        : null,
      __t: timestamps, __alt: alts, __track: tracks, __gs: gsVals,
    },
    geometry: { type: "LineString", coordinates: coords },
  };
}

// -- ETL: stream tar sequenzialmente -> array di features ---------------------
async function runEtl(
  urls: string[],
  bbox: [number, number, number, number],
  tFrom: number,
  tTo: number,
  minPoints: number,
  noMilitary: boolean,
): Promise<GeoFeature[]> {
  const features: GeoFeature[] = [];
  const pass = new PassThrough();
  const ex = tarExtract();

  ex.on("entry", (header, stream, next) => {
    if (!header.name.includes("trace_full_")) {
      stream.resume();
      next();
      return;
    }
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => {
      try {
        const feat = parseTrace(
          Buffer.concat(chunks), bbox, tFrom, tTo, minPoints, noMilitary,
        );
        if (feat) features.push(feat);
      } catch {
        // entry malformata: ignora
      }
      next();
    });
    stream.on("error", () => next());
  });

  pass.pipe(ex);

  const extractDone = new Promise<void>((resolve, reject) => {
    ex.on("finish", resolve);
    ex.on("error", reject);
  });

  for (const url of urls) {
    const resp = await fetch(url, { signal: AbortSignal.timeout(600_000) });
    if (!resp.ok || !resp.body)
      throw new Error(`HTTP ${resp.status} su ${url.split("/").pop()}`);
    const reader = resp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!pass.write(value)) {
        await new Promise<void>((resolve) => pass.once("drain", resolve));
      }
    }
  }

  pass.end();
  await extractDone;
  return features;
}

// -- Handler principale (BACKGROUND FUNCTION) ---------------------------------
//
// CON background:true Netlify invia il 202 automaticamente PRIMA che questo
// body esegua. Il valore di ritorno e' ignorato. NON usare async IIFE ne'
// return intermedi con Response: tutto il lavoro va svolto qui direttamente.
//
export default async (req: Request): Promise<void> => {
  // 1. Parse params (prima dell'auth: serve il jobId per scrivere error status)
  let params: Record<string, unknown> = {};
  try {
    params = (await req.json()) as Record<string, unknown>;
  } catch {
    return;
  }

  const date = typeof params.date === "string" ? params.date : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

  const bboxKey = typeof params.bbox === "string" ? params.bbox : "italy";
  let bbox: [number, number, number, number];
  if (bboxKey in BBOXES) {
    bbox = BBOXES[bboxKey];
  } else {
    const parts = bboxKey.split(",").map(Number);
    if (
      parts.length !== 4 ||
      parts.some((n) => !isFinite(n)) ||
      parts[0] < -90 || parts[1] > 90 ||
      parts[2] < -180 || parts[3] > 180
    ) return;
    bbox = [parts[0], parts[1], parts[2], parts[3]];
  }

  const fromStr = typeof params.from === "string" ? params.from : "00:00";
  const toStr   = typeof params.to   === "string" ? params.to   : "23:59";
  if (!/^\d{2}:\d{2}$/.test(fromStr) || !/^\d{2}:\d{2}$/.test(toStr)) return;

  const minPoints = typeof params.minPoints === "number"
    ? Math.max(1, Math.floor(params.minPoints))
    : 5;
  const noMilitary = params.noMilitary === true;

  const [yS, mS, dS] = date.split("-");
  const dayStart = Date.UTC(
    parseInt(yS, 10), parseInt(mS, 10) - 1, parseInt(dS, 10),
  ) / 1000;
  const [fh, fm] = fromStr.split(":");
  const [th, tm] = toStr.split(":");
  const tFrom = dayStart + parseInt(fh, 10) * 3600 + parseInt(fm, 10) * 60;
  const tTo   = dayStart + parseInt(th, 10) * 3600 + parseInt(tm, 10) * 60 + 59;

  const jobId = makeJobId(bboxKey, date, fromStr, toStr, noMilitary);
  const statusKey = `embed/adsb/${jobId}.status.json`;
  const geojsonKey = `embed/adsb/${jobId}.geojson`;

  // 2. Storage
  const spacesKey    = process.env.SPACES_KEY;
  const spacesSecret = process.env.SPACES_SECRET;
  const bucket       = process.env.SPACES_BUCKET;
  const region       = process.env.SPACES_REGION;
  if (!spacesKey || !spacesSecret || !bucket || !region) return;

  const s3 = makeS3(spacesKey, spacesSecret, region);

  // 3. Auth (scrive error status su S3 se fallisce, cosi' il client lo vede)
  const secret = process.env.STUDIO_SESSION_SECRET;
  if (!secret) {
    await putJson(s3, bucket, statusKey, {
      status: "error", message: "Auth non configurata.",
      finishedAt: new Date().toISOString(),
    }).catch(() => {});
    return;
  }
  const token = readCookie(req.headers.get("cookie"));
  if (!token || !verifyToken(token, secret)) {
    await putJson(s3, bucket, statusKey, {
      status: "error", message: "Non autenticato.",
      finishedAt: new Date().toISOString(),
    }).catch(() => {});
    return;
  }

  // 4. Idempotency: se gia' done, non rieseguire
  try {
    const existing = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: statusKey }),
    );
    const body = await existing.Body?.transformToString("utf-8");
    if (body) {
      const st = JSON.parse(body) as { status: string };
      if (st.status === "done") return;
    }
  } catch {
    // Non esiste ancora: procedi
  }

  // 5. Scrivi "running"
  try {
    await putJson(s3, bucket, statusKey, {
      status: "running",
      startedAt: new Date().toISOString(),
      date, bbox: bboxKey, from: fromStr, to: toStr, noMilitary,
    });
  } catch {
    return;
  }

  // 6. ETL
  console.log(`[adsb-etl] start ${jobId}`);
  try {
    const urls = await resolveTarUrls(date);
    console.log(`[adsb-etl] ${jobId}: ${urls.length} parti tar`);

    const features = await runEtl(urls, bbox, tFrom, tTo, minPoints, noMilitary);
    console.log(`[adsb-etl] ${jobId}: ${features.length} aerei`);

    const fc = {
      type: "FeatureCollection",
      metadata: {
        source: "adsb.lol/globe_history",
        license: "ODbL 1.0",
        attribution:
          "\u00a9 adsb.lol contributors (ODbL) \u2014 " +
          "opendatacommons.org/licenses/odbl/1.0/",
        date, bbox: Array.from(bbox), bbox_name: bboxKey,
        time_from_utc: fromStr, time_to_utc: toStr,
        military_excluded: noMilitary,
        aircraft_count: features.length,
        generated_at: new Date().toISOString(),
      },
      features,
    };

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: geojsonKey,
        Body: JSON.stringify(fc),
        ContentType: "application/geo+json; charset=utf-8",
        CacheControl: "public, max-age=86400",
        ACL: "public-read",
      }),
    );

    await putJson(s3, bucket, statusKey, {
      status: "done",
      count: features.length,
      url: `/embed/adsb/${jobId}.geojson`,
      date, bbox: bboxKey, from: fromStr, to: toStr, noMilitary,
      finishedAt: new Date().toISOString(),
    });

    console.log(`[adsb-etl] done ${jobId}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[adsb-etl] error ${jobId}:`, msg);
    await putJson(s3, bucket, statusKey, {
      status: "error", message: msg,
      finishedAt: new Date().toISOString(),
    }).catch(() => {});
  }
};

export const config = { path: "/api/adsb-etl", background: true };
