import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Upload,
  ShieldCheck,
  Info,
  CheckCircle2,
  AlertTriangle,
  Search,
  ExternalLink,
  Sparkles,
  Download,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useStudio } from "../../studio/StudioContext";
import {
  DATA_SOURCES,
  OSM_PRESETS,
  ZORNADE_DATASETS,
  DATA_CATEGORIES,
  DATA_CATALOG,
  searchDataCatalog,
  accessLabel,
  type DataSourceEntry,
} from "../../studio/catalog";
import { Button, PanelSection, SoonBadge, Field } from "../primitives";
import { parseCsv, detectNumericColumns } from "../../lib/csv";
import {
  GEO_LEVELS,
  detectGeoLevel,
  detectKeyColumn,
  resolveGeoJoin,
  type GeoLevel,
} from "../../lib/choropleth";
import { loadGeoKeys } from "../../lib/geo-keys";
import { readFileSmart } from "../../lib/ingest/decode";
import { parseExcel } from "../../lib/ingest/parse-excel";
import { parseGeoJson } from "../../lib/ingest/parse-geojson";
import {
  catalogApiAvailable,
  searchCkan,
  fetchResourceText,
  CATALOG_PORTALS,
  type CkanDataset,
  type CkanResource,
} from "../../lib/catalog-api";
import type { DatasetState, ProjectMeta } from "../../studio/types";

type DataMode = "home" | "catalog" | "own";

/**
 * Parse CSV text into a ready DatasetState, or return a human error message.
 * Shared by file upload and the live catalogue loader.
 *
 * Geo level + key column are resolved by matching actual values against the
 * real geometry keys ({@link resolveGeoJoin}); name-based detection is only a
 * fallback when the keys index is unavailable.
 */
async function buildDatasetFromCsv(
  text: string,
  fileName: string,
): Promise<{ dataset: DatasetState } | { error: string }> {
  return buildDatasetFromTable(parseCsv(text), fileName);
}

/**
 * Turn an already-parsed table ({ columns, rows }) into a ready DatasetState,
 * or a human error message. Format-specific parsers (CSV, Excel, GeoJSON) all
 * funnel through here so geo-resolution, key/value detection and error
 * messages stay identical across formats.
 */
async function buildDatasetFromTable(
  table: { columns: string[]; rows: Record<string, string>[] },
  fileName: string,
): Promise<{ dataset: DatasetState } | { error: string }> {
  const { columns, rows } = table;
  if (columns.length === 0 || rows.length === 0) {
    return { error: "Il file sembra vuoto o non leggibile." };
  }

  let geoLevel: GeoLevel;
  let keyColumn: string;

  const keys = await loadGeoKeys();
  const resolved =
    Object.keys(keys).length > 0 ? resolveGeoJoin(columns, rows, keys) : null;

  if (resolved) {
    geoLevel = resolved.level;
    keyColumn = resolved.keyColumn;
  } else {
    // Fallback: name-based detection (keys index unavailable).
    const detected = detectGeoLevel(columns);
    if (!detected) {
      return {
        error:
          "Nessuna colonna geografica riconosciuta (es. codice_istat, sigla, comune).",
      };
    }
    if (!GEO_LEVELS[detected].ready) {
      const ready = Object.values(GEO_LEVELS)
        .filter((l) => l.ready)
        .map((l) => l.label)
        .join(", ");
      return {
        error: `Livello “${GEO_LEVELS[detected].label}” riconosciuto, ma la geometria non è ancora disponibile. Per ora: ${ready}.`,
      };
    }
    geoLevel = detected;
    keyColumn = detectKeyColumn(detected, columns)!;
  }

  const numericColumns = detectNumericColumns(columns, rows).filter(
    (c) => c !== keyColumn,
  );
  if (numericColumns.length === 0) {
    return { error: "Nessuna colonna numerica da mappare trovata." };
  }
  return {
    dataset: {
      fileName,
      columns,
      rows,
      geoLevel,
      keyColumn,
      valueColumn: numericColumns[0],
      numericColumns,
    },
  };
}

/**
 * Derive a human title from a file name: drop the extension, turn separators
 * into spaces, collapse whitespace and capitalise the first letter. Returns ""
 * for opaque names (UUID/hex exports) that carry no human signal — detected by
 * requiring at least one run of 3+ consecutive letters (real words have it,
 * hex/UUID chunks like "ba5f" do not).
 */
export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "");
  const cleaned = base
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[a-zA-Z]{3,}/.test(cleaned)) return "";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
function applyDatasetMeta(
  updateProject: (patch: Partial<ProjectMeta>) => void,
  dataset: CkanDataset,
): void {
  const patch: Partial<ProjectMeta> = {};
  const title = dataset.title?.trim();
  if (title) patch.title = title;
  const subtitle = dataset.notes?.trim();
  if (subtitle) {
    patch.subtitle =
      subtitle.length > 160 ? `${subtitle.slice(0, 157).trimEnd()}…` : subtitle;
  }
  const publisher = dataset.publisher?.trim();
  if (publisher) patch.source = `Fonte: ${publisher} · Fatto con Zornade Studio`;
  if (Object.keys(patch).length > 0) updateProject(patch);
}

export function DataPanel() {
  const { dataSource, setDataSource } = useStudio();
  const [mode, setMode] = useState<DataMode>(dataSource ? "own" : "home");

  // A concrete source (upload/osm/…) is selected → show its detail view.
  if (dataSource) {
    const meta = DATA_SOURCES.find((s) => s.id === dataSource);
    return (
      <div className="space-y-4">
        <button
          onClick={() => setDataSource(null)}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          Cambia sorgente
        </button>
        <PanelSection title={meta?.label ?? ""} hint={meta?.desc}>
          {dataSource === "upload" && <UploadSource />}
          {dataSource === "osm" && <OsmSource />}
          {dataSource === "zornade-db" && <ZornadeDbSource />}
          {(dataSource === "paste" ||
            dataSource === "url" ||
            dataSource === "api") && <ComingSoon />}
        </PanelSection>
      </div>
    );
  }

  if (mode === "catalog") {
    return <DataCatalog onBack={() => setMode("home")} />;
  }

  if (mode === "own") {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setMode("home")}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          Indietro
        </button>
        <PanelSection
          title="Carica i tuoi dati"
          hint="Da file, foglio di calcolo, URL o servizi."
        >
          <div className="grid gap-2">
            {DATA_SOURCES.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  onClick={() => setDataSource(s.id as never)}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left transition-all hover:border-zornade hover:shadow-sm"
                >
                  <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-zornade-50 text-zornade-700">
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      {s.label}
                      {s.status === "soon" && <SoonBadge />}
                    </span>
                    <span className="block text-xs text-slate-500">{s.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </PanelSection>
      </div>
    );
  }

  // Home: the very first choice.
  return (
    <PanelSection
      title="Da dove parti?"
      hint="Scegli i dati di partenza per la tua mappa."
    >
      <div className="grid gap-3">
        <button
          onClick={() => setMode("catalog")}
          className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition-all hover:border-zornade hover:shadow-md"
        >
          <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl bg-zornade-50 text-zornade-700">
            <Sparkles size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-800">
              Usa dati pronti
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Catalogo di fonti ufficiali e autorevoli per l'Italia (ISTAT,
              ISPRA, Agenzia Entrate, INGV…). Cerca per tema e collègati alla
              fonte.
            </span>
          </span>
        </button>

        <button
          onClick={() => setMode("own")}
          className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition-all hover:border-zornade hover:shadow-md"
        >
          <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
            <Upload size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-800">
              Carica i tuoi dati
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Hai già un file (CSV, Excel, GeoJSON…) o un foglio di calcolo?
              Caricalo e aggancia automaticamente la geografia.
            </span>
          </span>
        </button>
      </div>
    </PanelSection>
  );
}

/* ------------------------------ Data catalog ------------------------------ */

function DataCatalog({ onBack }: { onBack: () => void }) {
  const [live, setLive] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    catalogApiAvailable().then((ok) => {
      if (!cancelled) setLive(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (live === null) {
    return (
      <div className="space-y-4">
        <BackButton onClick={onBack} />
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" />
          Carico il catalogo…
        </div>
      </div>
    );
  }

  return live ? (
    <LiveCatalog onBack={onBack} />
  ) : (
    <CuratedCatalog onBack={onBack} />
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
    >
      <ArrowLeft size={14} />
      Indietro
    </button>
  );
}

/* --------------------------- Live catalog (CKAN) -------------------------- */

const PAGE_SIZE = 25;

function LiveCatalog({ onBack }: { onBack: () => void }) {
  const [portal, setPortal] = useState("nazionale");
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ count: number; results: CkanDataset[] } | null>(
    null,
  );

  const runSearch = async (q: string, p: string, pg: number) => {
    setLoading(true);
    setError(null);
    setSubmitted(q);
    setPage(pg);
    try {
      const res = await searchCkan(q, p, pg * PAGE_SIZE, PAGE_SIZE);
      setData({ count: res.count, results: res.results });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore di ricerca.");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const totalPages = data ? Math.ceil(data.count / PAGE_SIZE) : 0;
  const from = data ? page * PAGE_SIZE + 1 : 0;
  const to = data ? page * PAGE_SIZE + data.results.length : 0;

  return (
    <div className="space-y-4">
      <BackButton onClick={onBack} />
      <PanelSection
        title="Catalogo dati"
        hint="Cerca tra i dataset pubblicati dai portali open data italiani e caricali direttamente."
      >
        {/* Portal selector */}
        <Field label="Portale">
          <select
            value={portal}
            onChange={(e) => {
              setPortal(e.target.value);
              if (submitted) void runSearch(submitted, e.target.value, 0);
            }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-zornade focus:outline-none"
          >
            {CATALOG_PORTALS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        {/* Search */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(query, portal, 0);
          }}
          className="relative"
        >
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca: popolazione, prezzi case, scuole, rifiuti…"
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-zornade focus:outline-none focus:ring-2 focus:ring-zornade/20"
          />
        </form>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" />
            Cerco…
          </div>
        )}

        {error && (
          <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            {error}
          </p>
        )}

        {!loading && data && (
          <>
            <p className="text-[11px] text-slate-400">
              {data.count.toLocaleString("it-IT")} dataset trovati
              {submitted ? ` per “${submitted}”` : ""}
              {data.results.length > 0 ? ` · ${from}–${to}` : ""}
            </p>
            <div className="space-y-2">
              {data.results.map((d) => (
                <LiveDatasetCard key={d.id} dataset={d} />
              ))}
              {data.results.length === 0 && (
                <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
                  Nessun dataset con risorse caricabili in questa pagina. Prova
                  la pagina successiva o un'altra ricerca.
                </p>
              )}
            </div>

            {/* Pager */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  onClick={() => void runSearch(submitted, portal, page - 1)}
                  disabled={page === 0}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft size={14} />
                  Precedenti
                </button>
                <span className="text-[11px] text-slate-400">
                  Pagina {page + 1} di {totalPages.toLocaleString("it-IT")}
                </span>
                <button
                  onClick={() => void runSearch(submitted, portal, page + 1)}
                  disabled={page + 1 >= totalPages}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Successivi
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </>
        )}

        {!loading && !data && !error && (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
            Scrivi una parola chiave e premi Invio per cercare nei portali
            open data.
          </p>
        )}

        <p className="mt-1 text-[11px] text-slate-400">
          I dati restano dei rispettivi enti pubblici: verifica licenza e
          attribuzione sulla scheda della fonte.
        </p>
      </PanelSection>
    </div>
  );
}

function LiveDatasetCard({ dataset }: { dataset: CkanDataset }) {
  const { setData, setStep, updateProject } = useStudio();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadResource = async (r: CkanResource) => {
    if (r.format !== "CSV") {
      setError(
        `Per ora si può caricare in mappa solo il CSV. “${r.format}”: usa “Apri la fonte”.`,
      );
      return;
    }
    setBusy(r.url);
    setError(null);
    try {
      const text = await fetchResourceText(r.url);
      const out = await buildDatasetFromCsv(text, r.name || dataset.title);
      if ("error" in out) {
        setError(out.error);
        return;
      }
      setData(out.dataset);
      // A ready catalogue source carries its own title/description: use them as
      // the default project title/subtitle (still editable in the Design step).
      applyDatasetMeta(updateProject, dataset);
      setStep("visualize");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Caricamento fallito.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left"
      >
        <p className="text-sm font-medium text-slate-800">{dataset.title}</p>
        <p className="text-[11px] font-medium uppercase tracking-wide text-zornade-700">
          {dataset.publisher}
        </p>
        {dataset.notes && (
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-500">
            {dataset.notes}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {[...new Set(dataset.resources.map((r) => r.format))].map((f) => (
            <span
              key={f}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
            >
              {f}
            </span>
          ))}
        </div>
      </button>

      {open && (
        <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
          {dataset.resources.map((r) => (
            <div
              key={r.url}
              className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5"
            >
              <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                {r.format}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-600">
                {r.name || "risorsa"}
              </span>
              <button
                onClick={() => void loadResource(r)}
                disabled={busy === r.url}
                title="Carica nella mappa"
                className="flex items-center gap-1 rounded-md bg-zornade px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-zornade-700 disabled:opacity-60"
              >
                {busy === r.url ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Download size={12} />
                )}
                Carica
              </button>
            </div>
          ))}
          <a
            href={dataset.landing}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 pt-1 text-[11px] font-medium text-slate-500 hover:text-zornade-700"
          >
            <ExternalLink size={12} />
            Apri la fonte
          </a>
          {error && (
            <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------------- Curated catalog (fallback) ----------------------- */

function CuratedCatalog({ onBack }: { onBack: () => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const results = useMemo(
    () => searchDataCatalog(query, category),
    [query, category],
  );

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft size={14} />
        Indietro
      </button>

      <PanelSection
        title="Catalogo dati"
        hint="Fonti ufficiali e autorevoli. Apri la fonte, scarica i dati, poi caricali in “I tuoi dati”."
      >
        {/* Search box */}
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca: prezzi case, terremoti, scuole, redditi…"
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-zornade focus:outline-none focus:ring-2 focus:ring-zornade/20"
          />
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategory(null)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              category === null
                ? "border-zornade bg-zornade-50 text-zornade-700"
                : "border-slate-200 text-slate-500 hover:border-slate-300"
            }`}
          >
            Tutte
          </button>
          {DATA_CATEGORIES.map((c) => {
            const Icon = c.icon;
            return (
              <button
                key={c.id}
                onClick={() => setCategory(category === c.id ? null : c.id)}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  category === c.id
                    ? "border-zornade bg-zornade-50 text-zornade-700"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                <Icon size={12} />
                {c.label}
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-slate-400">
          {results.length} font{results.length === 1 ? "e" : "i"} trovate
        </p>

        {/* Results */}
        <div className="space-y-2">
          {results.map((e) => (
            <DataCatalogCard key={e.id} entry={e} />
          ))}
          {results.length === 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
              Nessuna fonte trovata. Prova con un'altra parola chiave.
            </p>
          )}
        </div>

        <p className="mt-2 text-[11px] text-slate-400">
          Catalogo curato di {DATA_CATALOG.length} fonti. I dati restano dei
          rispettivi enti; verifica sempre licenza e attribuzione della fonte.
        </p>
      </PanelSection>
    </div>
  );
}

function DataCatalogCard({ entry }: { entry: DataSourceEntry }) {
  return (
    <a
      href={entry.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl border border-slate-200 bg-white p-3 transition-all hover:border-zornade hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-800">
            {entry.name}
          </p>
          <p className="text-[11px] font-medium uppercase tracking-wide text-zornade-700">
            {entry.provider}
          </p>
        </div>
        <ExternalLink size={14} className="mt-0.5 flex-shrink-0 text-slate-400" />
      </div>
      <p className="mt-1 text-xs leading-snug text-slate-500">
        {entry.description}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {entry.access.map((a) => (
          <span
            key={a}
            className="rounded bg-zornade-50 px-1.5 py-0.5 text-[10px] font-medium text-zornade-700"
          >
            {accessLabel(a)}
          </span>
        ))}
        {entry.formats.slice(0, 3).map((f) => (
          <span
            key={f}
            className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
          >
            {f}
          </span>
        ))}
      </div>
    </a>
  );
}

function UploadSource() {
  const { data, setData, setStep, project, updateProject } = useStudio();
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    const name = file.name.toLowerCase();

    // Dispatch by extension to the right parser; every format funnels into the
    // same buildDatasetFromTable so geo-resolution + errors are identical.
    let out: { dataset: DatasetState } | { error: string };
    try {
      if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
        // Decode with UTF-8 → Windows-1252 fallback (Italian Excel exports).
        const { text } = await readFileSmart(file);
        out = await buildDatasetFromCsv(text, file.name);
      } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const table = await parseExcel(await file.arrayBuffer());
        out = await buildDatasetFromTable(table, file.name);
      } else if (name.endsWith(".geojson") || name.endsWith(".json")) {
        const { text } = await readFileSmart(file);
        const parsed = parseGeoJson(text);
        out =
          "error" in parsed
            ? parsed
            : await buildDatasetFromTable(parsed, file.name);
      } else if (
        name.endsWith(".zip") ||
        name.endsWith(".shp") ||
        name.endsWith(".kml") ||
        name.endsWith(".kmz") ||
        name.endsWith(".tif") ||
        name.endsWith(".tiff")
      ) {
        // Shapefile/KML/GeoTIFF carry geometry as their primary payload; they
        // need a geometry-rendering layer that doesn't exist yet (in arrivo).
        setError(
          "Shapefile, KML/KMZ e GeoTIFF sono in arrivo. Per ora: CSV, Excel (.xlsx) e GeoJSON.",
        );
        return;
      } else {
        setError("Formato non supportato. Usa CSV, Excel (.xlsx) o GeoJSON.");
        return;
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? `Impossibile leggere il file: ${e.message}`
          : "Impossibile leggere il file.",
      );
      return;
    }

    if ("error" in out) {
      setError(out.error);
      return;
    }
    setData(out.dataset);
    // Default the title from the file name (a file has no title metadata), only
    // if the operator hasn't already set one — never overwrite manual input.
    if (!project.title || project.title === "Mappa senza titolo") {
      const t = titleFromFileName(file.name);
      if (t) updateProject({ title: t });
    }
    // Don't pre-pick a viz: the next step is the visualization choice, where
    // only compatible options are enabled.
    setStep("visualize");
  };

  if (data) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0 text-emerald-600" />
          <div className="min-w-0 text-xs text-emerald-800">
            <p className="font-medium">{data.fileName}</p>
            <p className="text-emerald-700">
              {data.rows.length} righe · livello {GEO_LEVELS[data.geoLevel].label}{" "}
              · chiave “{data.keyColumn}”
            </p>
          </div>
        </div>

        <Field label="Colonna da mappare">
          <select
            value={data.valueColumn}
            onChange={(e) => setData({ ...data, valueColumn: e.target.value })}
            className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-zornade focus:outline-none"
          >
            {data.numericColumns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Button variant="secondary" onClick={() => setData(null)} className="w-full">
          Carica un altro file
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition-colors hover:border-zornade hover:bg-zornade-50">
        <Upload size={22} className="text-slate-400" />
        <span className="text-sm font-medium text-slate-700">
          Trascina un file o clicca per caricare
        </span>
        <span className="text-xs text-slate-500">
          CSV, Excel (.xlsx) e GeoJSON · Shapefile, KML, GeoTIFF in arrivo
        </span>
        <input
          type="file"
          accept=".csv,.xlsx,.geojson,.json,.zip,.kml,.kmz,.tif,.tiff"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </label>
      {error && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          {error}
        </p>
      )}
      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        <Info size={13} className="mt-0.5 flex-shrink-0" />
        Aggancio automatico su CAP, comune o provincia per la coropletica.
      </p>
    </div>
  );
}

function OsmSource() {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium text-slate-600">Cosa cerchi?</p>
        <div className="flex flex-wrap gap-2">
          {OSM_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p.id)}
              title={p.tag}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                selected === p.id
                  ? "border-zornade bg-zornade-50 text-zornade-700"
                  : "border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <Field label="Ambito">
        <select className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-zornade focus:outline-none">
          <option>Tutta Italia</option>
          <option>Per regione…</option>
          <option>Per provincia…</option>
          <option>Per comune…</option>
          <option>Area disegnata sulla mappa</option>
        </select>
      </Field>
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled className="flex-1">
          Cerca su OpenStreetMap
        </Button>
        <SoonBadge />
      </div>
      <p className="text-xs text-slate-500">
        I risultati appariranno come punti sovrapposti alla mappa, con conteggio
        e dettagli al passaggio.
      </p>
    </div>
  );
}

function ZornadeDbSource() {
  const [dataset, setDataset] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-zornade-50 p-3">
        <p className="flex items-start gap-1.5 text-xs text-zornade-900">
          <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />
          Connessione in <strong>sola lettura</strong> con credenziali dedicate.
          Le credenziali passano da un proxy sicuro e non vengono mai salvate nel
          browser.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <Field label="Host">
          <input
            placeholder="db.zornade.com"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-zornade focus:outline-none"
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Utente">
            <input
              placeholder="readonly_redazione"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-zornade focus:outline-none"
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              placeholder="••••••••"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-zornade focus:outline-none"
            />
          </Field>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-slate-600">
          Dataset disponibili
        </p>
        <div className="grid gap-2">
          {ZORNADE_DATASETS.map((d) => (
            <button
              key={d.id}
              onClick={() => setDataset(d.id)}
              className={`rounded-xl border p-2.5 text-left transition-colors ${
                dataset === d.id
                  ? "border-zornade bg-zornade-50"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <span className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-800">
                  {d.label}
                </span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-500">
                  per {d.level}
                </span>
              </span>
              <span className="block text-xs text-slate-500">{d.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="primary" disabled className="flex-1">
          Connetti e carica
        </Button>
        <SoonBadge />
      </div>
    </div>
  );
}

function ComingSoon() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-600">In arrivo</p>
      <p className="mt-1 text-xs text-slate-500">
        Questa sorgente è nella roadmap. Per ora usa “Carica file”.
      </p>
    </div>
  );
}
