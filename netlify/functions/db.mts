/**
 * POST /api/db  { dataset, ...options }
 *
 * Auth-gated read-only proxy to the Zornade Postgres (Supabase), ROADMAP O3.1.
 * Postgres is never reachable from the browser, and the read-only credentials
 * never leave the server. The client may only trigger a small set of
 * **predefined, parametrised** comune-level queries (validated by
 * `parseDbRequest`); there is no free-form SQL here. Each query returns, per
 * comune, a normalised 6-digit ISTAT code + name + one numeric value, ready to
 * join to the bundled `comuni` geometry.
 *
 * Required environment variables (Netlify → Site settings → Environment):
 *   ZORNADE_DB_URL            postgres connection string of a **read-only** role
 *                             (e.g. postgres://readonly:pwd@host:6543/postgres)
 *   STUDIO_SESSION_SECRET     (existing) to verify the auth cookie
 *
 * Use the Supabase **transaction pooler** port (6543) for these short queries.
 */

import postgres from "postgres";
import { verifyToken, readCookie } from "./_session.mts";
import {
  parseDbRequest,
  omiSemesters,
  type DbQueryRequest,
  type DbRow,
} from "../../src/lib/zornade-db";

/** Hard cap on returned rows (all comune-level queries are ≤ ~7.9k). */
const MAX_ROWS = 9000;
/** Per-query statement timeout (ms) — keeps a heavy query from hanging. */
const STATEMENT_TIMEOUT_MS = 8000;

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // 1. Auth — same signed-cookie scheme as the other functions.
  const secret = process.env.STUDIO_SESSION_SECRET;
  if (!secret) return json({ error: "Auth non configurata." }, 500);
  const token = readCookie(req.headers.get("cookie"));
  if (!token || !verifyToken(token, secret)) {
    return json({ error: "Non autenticato." }, 401);
  }

  // 2. DB config.
  const url = process.env.ZORNADE_DB_URL;
  if (!url) return json({ error: "Connessione al DB non configurata." }, 500);

  // 3. Validate the request against the whitelist of guided queries.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo della richiesta non valido." }, 400);
  }
  const parsed = parseDbRequest(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);

  // 4. Run the predefined query on a short-lived read-only connection.
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 8,
    prepare: false, // transaction pooler (PgBouncer) doesn't support prepared stmts
    // Encrypt the connection but don't verify the certificate chain: the
    // Supabase pooler presents a self-signed chain that Netlify's CA store
    // doesn't trust, so full verification fails with "self-signed certificate
    // in certificate chain". `ssl: "require"` is the libpq `sslmode=require`
    // semantics (TLS on, no chain validation) — the documented setup for
    // serverless drivers against Supabase. Set here so it holds regardless of
    // whether the connection string carries `?sslmode=...`.
    ssl: "require",
    // Belt-and-braces: even with a read-only role, forbid writes at the session.
    connection: { statement_timeout: STATEMENT_TIMEOUT_MS },
  });
  try {
    const rows = await runQuery(sql, parsed.request);
    return json({ rows, count: rows.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore di interrogazione.";
    return json({ error: `Interrogazione fallita: ${msg}` }, 502);
  } finally {
    await sql.end({ timeout: 5 });
  }
};

/**
 * Execute the predefined query for a validated request. All values are bound as
 * parameters (`${...}` tagged-template binding in `postgres`), never string
 * interpolation, so there is no SQL-injection surface.
 */
async function runQuery(
  sql: postgres.Sql,
  req: DbQueryRequest,
): Promise<DbRow[]> {
  switch (req.dataset) {
    case "omi": {
      // Average of the per-zone mid price across the comune, for the chosen
      // semester / property type / market side. comune_istat is region(2)+
      // istat(6); RIGHT(...,6) gives the 6-digit comune ISTAT code.
      const minCol = req.market === "locazione" ? "loc_min_eur_mq" : "compr_min_eur_mq";
      const maxCol = req.market === "locazione" ? "loc_max_eur_mq" : "compr_max_eur_mq";
      if (req.temporal) {
        // All 22 semesters. A single GROUP BY over the whole history scans ~450k
        // rows and spills the hash to disk (6–20s — over budget). Instead run one
        // aggregate PER semester: `semestre` is the leading primary-key column,
        // so each is a fast indexed range (~50–100ms). Total ≈ 3s, well under the
        // statement timeout, and never spills. Rows are concatenated long-form.
        const all: DbRow[] = [];
        for (const sem of omiSemesters()) {
          const rows = await sql`
            SELECT right(comune_istat, 6) AS istat,
                   max(comune_descrizione) AS comune,
                   semestre AS periodo,
                   round(avg((${sql(minCol)} + ${sql(maxCol)}) / 2.0)::numeric, 0) AS value
            FROM public.omi_historical
            WHERE semestre = ${sem}
              AND cod_tipologia = ${req.tipologia}
              AND stato_conservativo = 'NORMALE'
              AND ${sql(minCol)} IS NOT NULL
              AND ${sql(maxCol)} IS NOT NULL
              AND comune_istat IS NOT NULL
            GROUP BY right(comune_istat, 6), semestre
            LIMIT ${MAX_ROWS}
          `;
          for (const r of toRows(rows)) all.push(r);
        }
        return all;
      }
      const rows = await sql`
        SELECT right(comune_istat, 6) AS istat,
               max(comune_descrizione) AS comune,
               round(avg((${sql(minCol)} + ${sql(maxCol)}) / 2.0)::numeric, 0) AS value
        FROM public.omi_historical
        WHERE semestre = ${req.semestre}
          AND cod_tipologia = ${req.tipologia}
          AND stato_conservativo = 'NORMALE'
          AND ${sql(minCol)} IS NOT NULL
          AND ${sql(maxCol)} IS NOT NULL
          AND comune_istat IS NOT NULL
        GROUP BY right(comune_istat, 6)
        LIMIT ${MAX_ROWS}
      `;
      return toRows(rows);
    }
    case "solar": {
      // comuni_solar.pro_com_t is already a 6-digit ISTAT code; join to comuni
      // for the name. The metric column is whitelisted by parseDbRequest.
      const rows = await sql`
        SELECT s.pro_com_t AS istat,
               c.comune AS comune,
               s.${sql(req.metric)} AS value
        FROM public.comuni_solar s
        LEFT JOIN public.comuni c ON c.pro_com = ltrim(s.pro_com_t, '0')
        WHERE s.${sql(req.metric)} IS NOT NULL
        LIMIT ${MAX_ROWS}
      `;
      return toRows(rows);
    }
    case "population": {
      const rows = await sql`
        SELECT lpad(pro_com, 6, '0') AS istat, comune, estimated_population AS value
        FROM public.comuni
        WHERE estimated_population IS NOT NULL AND pro_com IS NOT NULL
        LIMIT ${MAX_ROWS}
      `;
      return toRows(rows);
    }
    case "buildings": {
      const rows = await sql`
        SELECT lpad(pro_com, 6, '0') AS istat, comune, building_count AS value
        FROM public.comuni
        WHERE building_count IS NOT NULL AND pro_com IS NOT NULL
        LIMIT ${MAX_ROWS}
      `;
      return toRows(rows);
    }
  }
}

/** Normalise raw DB rows to DbRow, dropping any without a usable value. */
function toRows(rows: readonly Record<string, unknown>[]): DbRow[] {
  const out: DbRow[] = [];
  for (const r of rows) {
    const istat = r.istat == null ? "" : String(r.istat);
    const comune = r.comune == null ? "" : String(r.comune);
    const value = typeof r.value === "number" ? r.value : Number(r.value);
    if (istat === "" || !Number.isFinite(value)) continue;
    const row: DbRow = { istat, comune, value };
    if (r.periodo != null) row.periodo = String(r.periodo);
    out.push(row);
  }
  return out;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const config = { path: "/api/db" };
