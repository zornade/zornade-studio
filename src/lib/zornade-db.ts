/**
 * Zornade DB guided datasets (ROADMAP O3.1).
 *
 * The Zornade Postgres (Supabase) is **never** reachable from the browser; a
 * server-side proxy (`netlify/functions/db.mts`) runs a small set of
 * **predefined, parametrised** read-only queries and returns plain rows. This
 * module is the **single source of truth** shared by the proxy and the UI:
 *  - the catalogue of guided datasets and their options,
 *  - request validation/normalisation (so the proxy never trusts raw input),
 *  - the row → table conversion used to build a choropleth dataset.
 *
 * Every dataset is **comune-level** and verified against the live DB
 * (2026-06-17): OMI prices (`omi_historical`), solar (`comuni_solar`),
 * population and building count (`comuni`). Each query returns, per comune, a
 * normalised ISTAT code + name + one numeric value, so the existing value-based
 * geo-join matches the bundled `comuni` geometry by code or name.
 */

/** A guided dataset exposed by the Zornade DB source. */
export interface DbDatasetDef {
  id: string;
  label: string;
  desc: string;
  /** Human label for the produced value (legend/tooltip). */
  valueLabel: string;
  /** Optional unit of measure for the value. */
  valueUnit?: string;
}

/** OMI market side: purchase (compravendita) or rent (locazione). */
export type OmiMarket = "compravendita" | "locazione";

/** OMI property-type options (cod_tipologia → label), verified in the DB. */
export const OMI_TYPES: { code: string; label: string }[] = [
  { code: "20", label: "Abitazioni civili" },
  { code: "1", label: "Ville e villini" },
  { code: "21", label: "Abitazioni di tipo economico" },
  { code: "13", label: "Box" },
  { code: "5", label: "Negozi" },
  { code: "9", label: "Magazzini" },
  { code: "6", label: "Uffici" },
  { code: "10", label: "Laboratori" },
  { code: "7", label: "Capannoni tipici" },
  { code: "8", label: "Capannoni industriali" },
  { code: "16", label: "Autorimesse" },
  { code: "15", label: "Posti auto scoperti" },
];

/** Solar metric options on `comuni_solar`. */
export const SOLAR_METRICS: { id: string; label: string; unit: string }[] = [
  { id: "pvout_per_capita_kwh", label: "Produzione solare pro capite", unit: "kWh/ab" },
  { id: "kwp_max_total", label: "Potenza installabile", unit: "kWp" },
  { id: "high_viability_pct", label: "Tetti ad alta idoneità", unit: "%" },
];

/** The guided datasets, in display order. All comune-level. */
export const DB_DATASETS: DbDatasetDef[] = [
  {
    id: "omi",
    label: "Prezzi immobiliari (OMI)",
    desc: "€/m² medi per comune, 22 semestri 2015→2025",
    valueLabel: "Prezzo medio",
    valueUnit: "€/m²",
  },
  {
    id: "solar",
    label: "Potenziale solare",
    desc: "Produzione, potenza e idoneità dei tetti per comune",
    valueLabel: "Solare",
  },
  {
    id: "population",
    label: "Popolazione stimata",
    desc: "Abitanti stimati per comune",
    valueLabel: "Popolazione",
    valueUnit: "ab.",
  },
  {
    id: "buildings",
    label: "Numero di edifici",
    desc: "Edifici censiti per comune",
    valueLabel: "Edifici",
  },
];

/** All OMI semesters, newest first (2015_1 … 2025_2 exist in the DB). */
export function omiSemesters(): string[] {
  const out: string[] = [];
  for (let year = 2025; year >= 2015; year--) {
    for (const half of [2, 1]) out.push(`${year}_${half}`);
  }
  return out;
}

/** Request payload sent to the proxy (discriminated by `dataset`). */
export type DbQueryRequest =
  | { dataset: "omi"; semestre: string; tipologia: string; market: OmiMarket; temporal: boolean }
  | { dataset: "solar"; metric: string }
  | { dataset: "population" }
  | { dataset: "buildings" };

/** A single value row returned by the proxy. */
export interface DbRow {
  /** Zero-padded 6-digit ISTAT comune code (e.g. "058091"). */
  istat: string;
  /** Comune name (e.g. "Roma"). */
  comune: string;
  /** The numeric value for the comune. */
  value: number;
  /** Period label, present only for temporal (multi-semester) OMI queries. */
  periodo?: string;
}

const SEMESTRE_RE = /^20(1[5-9]|2[0-5])_[12]$/;

/**
 * Validate and normalise a raw request object (from the client) into a typed
 * {@link DbQueryRequest}, or return an error. The proxy calls this so it never
 * builds a query from untrusted free-form input - only whitelisted options.
 */
export function parseDbRequest(
  raw: unknown,
): { request: DbQueryRequest } | { error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { error: "Richiesta non valida." };
  }
  const r = raw as Record<string, unknown>;
  switch (r.dataset) {
    case "omi": {
      const semestre = String(r.semestre ?? "");
      if (!SEMESTRE_RE.test(semestre)) return { error: "Semestre non valido." };
      const tipologia = String(r.tipologia ?? "");
      if (!OMI_TYPES.some((t) => t.code === tipologia)) {
        return { error: "Tipologia OMI non valida." };
      }
      const market = r.market === "locazione" ? "locazione" : "compravendita";
      const temporal = r.temporal === true;
      return { request: { dataset: "omi", semestre, tipologia, market, temporal } };
    }
    case "solar": {
      const metric = String(r.metric ?? "");
      if (!SOLAR_METRICS.some((m) => m.id === metric)) {
        return { error: "Metrica solare non valida." };
      }
      return { request: { dataset: "solar", metric } };
    }
    case "population":
      return { request: { dataset: "population" } };
    case "buildings":
      return { request: { dataset: "buildings" } };
    default:
      return { error: "Dataset sconosciuto." };
  }
}

/**
 * Build the value label + unit for a request (so the editor labels the legend
 * correctly without re-deriving the dataset). Pure; mirrors the proxy output.
 */
export function describeDbRequest(req: DbQueryRequest): {
  valueLabel: string;
  valueUnit?: string;
  title: string;
} {
  switch (req.dataset) {
    case "omi": {
      const type = OMI_TYPES.find((t) => t.code === req.tipologia)?.label ?? "";
      const side = req.market === "locazione" ? "Affitto" : "Prezzo";
      const sem = req.semestre.replace("_", "/");
      const unit = req.market === "locazione" ? "€/m²·mese" : "€/m²";
      return {
        valueLabel: `${side} ${type.toLowerCase()}`,
        valueUnit: unit,
        title: req.temporal
          ? `${side} ${type.toLowerCase()} · 2015→2025`
          : `${side} ${type.toLowerCase()} · ${sem}`,
      };
    }
    case "solar": {
      const m = SOLAR_METRICS.find((x) => x.id === req.metric);
      return {
        valueLabel: m?.label ?? "Solare",
        valueUnit: m?.unit,
        title: m?.label ?? "Potenziale solare",
      };
    }
    case "population":
      return { valueLabel: "Popolazione", valueUnit: "ab.", title: "Popolazione stimata" };
    case "buildings":
      return { valueLabel: "Edifici", title: "Numero di edifici" };
  }
}

/**
 * Convert proxy rows into a tabular { columns, rows } ready for the area
 * dataset builder. Columns: `codice_istat`, `comune`, `valore` - plus `periodo`
 * for temporal (multi-semester) OMI, which drives the time slider. The
 * geo-resolve step matches `codice_istat` (or `comune`) against the comuni
 * geometry.
 */
export function dbRowsToTable(rows: DbRow[]): {
  columns: string[];
  rows: Record<string, string>[];
} {
  const temporal = rows.some((r) => r.periodo != null);
  const columns = temporal
    ? ["codice_istat", "comune", "periodo", "valore"]
    : ["codice_istat", "comune", "valore"];
  const tableRows: Record<string, string>[] = rows.map((r) => {
    const out: Record<string, string> = {
      codice_istat: r.istat,
      comune: r.comune,
      valore: String(r.value),
    };
    if (temporal) out.periodo = r.periodo ?? "";
    return out;
  });
  return { columns, rows: tableRows };
}

/**
 * Call the server-side proxy (`/api/db`) with a guided query. The proxy is
 * auth-gated and runs the predefined read-only query; it only exists on
 * Netlify, so in plain `vite` dev it 404s (the UI surfaces a clear message).
 */
export async function queryZornadeDb(req: DbQueryRequest): Promise<DbRow[]> {
  const res = await fetch("/api/db", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(req),
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error(
      "Il proxy del database non è raggiungibile (disponibile solo in produzione).",
    );
  }
  const data = (await res.json()) as { rows?: DbRow[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Errore ${res.status}`);
  return data.rows ?? [];
}
