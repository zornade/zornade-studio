/**
 * GET /api/eurostat?mode=search&q=<query>&start=<n>&rows=<n>
 *   → Cerca tra i dataset Eurostat. Restituisce un array di { code, label }.
 *
 * GET /api/eurostat?mode=data&code=<CODE>&geo=<IT|nuts2|nuts3>&filters=<JSON>
 *   → Scarica un dataset Eurostat (SDMX-JSON) e lo converte in CSV piatto.
 *     - geo=IT      → solo il valore aggregato Italia (&geo=IT)
 *     - geo=nuts2   → tutte le regioni NUTS2 italiane (ITC1..ITG2)
 *     - geo=nuts3   → tutte le province NUTS3 italiane (ITC11..ITG22)
 *   Il parametro `filters` è un JSON object opzionale di dimensioni da
 *   passare all'API (es. {"unit":"MIO_EUR","sex":"T"}). Queste vengono
 *   aggiunte come query-string. I valori non nella whitelist sono ignorati.
 *
 * Limite: risposta max 10 MB (ca. 500K obs) per prevenire OOM.
 * Cache: 6 h per i dati, 1 h per la ricerca.
 */

const EUROSTAT_BASE =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const EUROSTAT_CATALOG =
  "https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/dataflow/ESTAT?format=JSON&detail=allstubs&lang=EN";

/** Dimensioni accettate come filtro dall'utente (whitelist SSRF-safe). */
const FILTER_WHITELIST = new Set([
  "unit",
  "sex",
  "age",
  "airpol",
  "nace_r2",
  "c_resid",
  "vehicle",
  "indic_nrg",
  "indic_se",
  "isced11",
  "isco08",
  "worktime",
  "rskpovth",
  "deg_urb",
  "building",
  "aquaenv",
  "quantile",
  "statinfo",
  "sector",
  "month",
]);

// ── Risposta SDMX-JSON (subset usato) ───────────────────────────────────────

interface SdmxCategory {
  index: Record<string, number>;
  label: Record<string, string>;
}

interface SdmxDimension {
  category: SdmxCategory;
}

interface SdmxResponse {
  id: string[];
  size: number[];
  dimension: Record<string, SdmxDimension>;
  value: Record<string, number | null>;
  label?: string;
  updated?: string;
}

// ── Conversione SDMX → CSV ──────────────────────────────────────────────────

/**
 * Converte la risposta SDMX-JSON in righe CSV.
 * Le osservazioni null (dati mancanti) vengono saltate.
 */
function sdmxToCsv(data: SdmxResponse, geoFilterFn?: (geo: string) => boolean): string {
  const dims = data.id;
  const sizes = data.size;
  const dimObjs = dims.map((d) => data.dimension[d]);

  // Mappa posizione → {codice, label} per ogni dimensione
  const dimValues: Array<Array<{ code: string; label: string }>> = dims.map(
    (_, di) => {
      const cat = dimObjs[di].category;
      const entries = Object.entries(cat.index).sort((a, b) => a[1] - b[1]);
      return entries.map(([code]) => ({
        code,
        label: cat.label[code] ?? code,
      }));
    },
  );

  // Intestazione: per ogni dimensione due colonne (<dim> e <dim>_label),
  // poi "value".
  const headers: string[] = [];
  for (const d of dims) {
    headers.push(d);
    // Includi _label solo per geo e time (evita esplosione colonne)
    if (d === "geo" || d === "time") headers.push(`${d}_label`);
  }
  headers.push("value");

  const rows: string[][] = [headers];

  // Calcola strides (prodotto delle size delle dimensioni successive)
  const strides = new Array(dims.length).fill(0);
  strides[dims.length - 1] = 1;
  for (let i = dims.length - 2; i >= 0; i--) {
    strides[i] = strides[i + 1] * sizes[i + 1];
  }

  const totalObs = sizes.reduce((a, b) => a * b, 1);

  // Indice della dimensione geo (per il filtro post-fetch)
  const geoIdx = dims.indexOf("geo");

  for (let idx = 0; idx < totalObs; idx++) {
    const v = data.value[String(idx)];
    if (v == null) continue;

    const row: string[] = [];
    let remaining = idx;
    let geoCode: string | undefined;
    for (let di = 0; di < dims.length; di++) {
      const pos = Math.floor(remaining / strides[di]);
      remaining = remaining % strides[di];
      const entry = dimValues[di][pos];
      const d = dims[di];
      if (di === geoIdx) geoCode = entry?.code;
      row.push(entry?.code ?? "");
      if (d === "geo" || d === "time") {
        // geo_label: usa l'etichetta SDMX nativa (valida per tutti i paesi UE)
        row.push(entry?.label ?? entry?.code ?? "");
      }
    }

    // Applica filtro geo se specificato
    if (geoFilterFn && geoCode !== undefined && !geoFilterFn(geoCode)) continue;

    row.push(String(v));
    rows.push(row);
  }

  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "data";

  if (mode === "search") {
    return handleSearch(url);
  }
  if (mode === "data") {
    return handleData(url);
  }
  return json({ error: "Parametro mode non valido (search|data)." }, 400);
};

async function handleSearch(url: URL): Promise<Response> {
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 100);
  const rows = Math.min(50, Math.max(1, Number(url.searchParams.get("rows") ?? "20") | 0));
  const start = Math.max(0, Number(url.searchParams.get("start") ?? "0") | 0);

  let catalog: unknown;
  try {
    const res = await fetch(EUROSTAT_CATALOG, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    catalog = await res.json();
  } catch (e) {
    return json({ error: `Catalogo Eurostat non raggiungibile: ${String(e)}` }, 502);
  }

  // Il catalogo SDMX-JSON ha struttura:
  //   { data: { dataflows: [ { id, name } ] } }
  //   oppure { Structure: { Dataflows: { Dataflow: [...] } } } (SDMX 2.1 XML-like)
  // La risposta JSON effettiva dal formato allstubs ha:
  //   link[].href per ogni dataset + label nei name[]
  // Usiamo la forma più semplice: iterazione su .link
  type CatalogShape = {
    link?: Array<{ href?: string; urn?: string }>;
    data?: { dataflows?: Array<{ id?: string; name?: Record<string, string> }> };
  };
  const cat = catalog as CatalogShape;

  // Il formato reale restituisce un array di dataflow nella chiave "data.dataflows"
  // con shape { id, name: { en: "..." }, ... }
  const flows: Array<{ code: string; label: string }> = [];

  if (cat.data?.dataflows) {
    for (const df of cat.data.dataflows) {
      const code = df.id ?? "";
      const label = df.name?.["en"] ?? df.name?.["it"] ?? code;
      flows.push({ code, label });
    }
  }

  const filtered = q
    ? flows.filter(
        (f) =>
          f.code.toLowerCase().includes(q) ||
          f.label.toLowerCase().includes(q),
      )
    : flows;

  const page = filtered.slice(start, start + rows);
  return json(
    { count: filtered.length, results: page },
    200,
    "public, max-age=3600",
  );
}

async function handleData(url: URL): Promise<Response> {
  const code = (url.searchParams.get("code") ?? "").trim().toUpperCase();
  if (!code || !/^[A-Z0-9_]+$/.test(code)) {
    return json({ error: "Parametro code mancante o non valido." }, 400);
  }

  const geoParam = url.searchParams.get("geo") ?? "nuts2";
  const filtersRaw = url.searchParams.get("filters") ?? "{}";

  let filters: Record<string, string> = {};
  try {
    const parsed = JSON.parse(filtersRaw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      filters = parsed as Record<string, string>;
    }
  } catch {
    // filters non validi: ignora silenziosamente
  }

  // Applica solo filtri dalla whitelist; i valori sono limitati a 50 char
  const safeFilters: Record<string, string> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (FILTER_WHITELIST.has(k) && typeof v === "string" && v.length <= 50) {
      safeFilters[k] = v;
    }
  }

  // Filtro paese opzionale (2 lettere ISO maiuscole, es. "IT", "DE", "FR")
  const countryRaw = (url.searchParams.get("country") ?? "").trim().toUpperCase();
  const country = /^[A-Z]{2}$/.test(countryRaw) ? countryRaw : "";

  // Strategia geo:
  // - paese: se country specificato, passa ?geo=<COUNTRY>; altrimenti nessun filtro (tutti i paesi UE)
  // - nuts2/nuts3: nessun filtro geo (l'API restituisce tutti); post-filtrare per lunghezza + prefisso paese
  const apiParams = new URLSearchParams({ format: "JSON", lang: "EN" });
  if (geoParam === "paese" && country) {
    apiParams.append("geo", country);
  }
  // Per nuts2/nuts3 non passiamo filtri geo: la post-filtratura avviene in sdmxToCsv
  for (const [k, v] of Object.entries(safeFilters)) {
    apiParams.append(k, v);
  }

  // Funzione di post-filtro per riga geo basata su geoParam e country
  // NUTS2 = 4 char (es. ITC1, DE21); NUTS3 = 5 char (es. ITC11, DE211)
  // Paese = 2 char ISO maiuscolo
  let geoFilterFn: ((geo: string) => boolean) | undefined;
  if (geoParam === "nuts2") {
    geoFilterFn = (g) =>
      g.length === 4 &&
      /^[A-Z]{2}/.test(g) &&
      (country ? g.startsWith(country) : true);
  } else if (geoParam === "nuts3") {
    geoFilterFn = (g) =>
      g.length === 5 &&
      /^[A-Z]{2}/.test(g) &&
      (country ? g.startsWith(country) : true);
  } else if (geoParam === "paese" && !country) {
    // Senza filtro paese: includi solo codici paese ISO-2 (esclude aggregati tipo EU27_2020, EA19)
    geoFilterFn = (g) => g.length === 2 && /^[A-Z]{2}$/.test(g);
  }

  const apiUrl = `${EUROSTAT_BASE}/${encodeURIComponent(code)}?${apiParams.toString()}`;

  let response: Response;
  try {
    response = await fetch(apiUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    return json({ error: `Eurostat non raggiungibile: ${String(e)}` }, 502);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return json(
      { error: `Eurostat ha risposto ${response.status}. ${body.slice(0, 200)}` },
      502,
    );
  }

  // Controlla dimensione risposta
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > 10_000_000) {
    return json(
      { error: "Il dataset è troppo grande per essere scaricato. Affina i filtri." },
      413,
    );
  }

  let data: SdmxResponse;
  try {
    data = (await response.json()) as SdmxResponse;
  } catch {
    return json({ error: "Risposta Eurostat non valida." }, 502);
  }

  // Filtro NUTS3 post-fetch: rimuovi geo che non corrispondono al geoParam
  if ((geoParam === "nuts3" || geoParam === "nuts2") && data.dimension?.geo) {
    const cat = data.dimension.geo.category;
    const validKeys = Object.keys(cat.index).filter((g) =>
      geoFilterFn ? geoFilterFn(g) : true,
    );
    if (validKeys.length === 0) {
      return json(
        { error: `Nessun dato NUTS disponibile per i filtri selezionati (geo=${geoParam}${country ? "/" + country : ""}).` },
        404,
      );
    }
  }

  const csv = sdmxToCsv(data, geoFilterFn);
  const rowCount = csv.split("\n").length - 1;

  if (rowCount === 0) {
    return json(
      { error: "Nessuna osservazione disponibile per i filtri selezionati. Prova a modificare i parametri." },
      404,
    );
  }

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "cache-control": "public, max-age=21600",
      "x-dataset-code": code,
      "x-row-count": String(rowCount),
      "x-updated": data.updated ?? "",
    },
  });
}

function json(data: unknown, status = 200, cacheControl = "public, max-age=300"): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": cacheControl,
    },
  });
}

export const config = { path: "/api/eurostat" };
