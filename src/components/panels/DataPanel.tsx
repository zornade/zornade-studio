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
  Download,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useStudio } from "../../studio/StudioContext";
import {
  DATA_SOURCES,
  SOURCE_GROUPS,
  OSM_PRESETS,
  OSM_GROUPS,
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
import { hasDrawableGeometry } from "../../lib/geo-dataset";
import { profileColumns } from "../../lib/profile";
import { detectWide, meltWide } from "../../lib/reshape";
import { detectTimeColumn, framesOf } from "../../lib/temporal";
import {
  buildOverpassQuery,
  runOverpass,
  overpassToTable,
  type OsmScope,
} from "../../lib/overpass";
import {
  catalogApiAvailable,
  searchCkan,
  fetchResourceText,
  CATALOG_PORTALS,
  type CkanDataset,
  type CkanResource,
} from "../../lib/catalog-api";
import {
  DB_DATASETS,
  OMI_TYPES,
  SOLAR_METRICS,
  omiSemesters,
  queryZornadeDb,
  dbRowsToTable,
  describeDbRequest,
  type DbQueryRequest,
  type OmiMarket,
} from "../../lib/zornade-db";
import type { DatasetState, ProjectMeta } from "../../studio/types";

type DataMode = "home" | "catalog";

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

  // 1) POINT path has priority: explicit lat/lon columns are unambiguous
  // geometry the user supplied on purpose. Detection requires the column to be
  // *named* lat/lon (+ in range), so real choropleth files — which have no such
  // columns — are never stolen by this branch.
  const profile = profileColumns(columns, rows);
  const latCol = profile.columns.find((c) => c.type === "geo-point-lat")?.name;
  const lonCol = profile.columns.find((c) => c.type === "geo-point-lon")?.name;
  if (latCol && lonCol) {
    const numericColumns = detectNumericColumns(columns, rows).filter(
      (c) => c !== latCol && c !== lonCol,
    );
    const categoryColumn = profile.columns.find(
      (c) => c.type === "categorical",
    )?.name;
    // Label column for tooltips: the first identifier/text column (a place
    // name like "città"), falling back to the category.
    const nameColumn =
      profile.columns.find(
        (c) =>
          (c.type === "identifier" || c.type === "text") &&
          c.name !== latCol &&
          c.name !== lonCol,
      )?.name ?? categoryColumn;
    return {
      dataset: {
        kind: "point",
        fileName,
        columns,
        rows,
        latColumn: latCol,
        lonColumn: lonCol,
        valueColumn: numericColumns[0] ?? "",
        categoryColumn,
        nameColumn,
        numericColumns,
      },
    };
  }

  // 2) AREA (choropleth) path: match values against geometry keys.
  // First, melt a WIDE table (one column per period, e.g. comune,2015,2016) to
  // long form so it becomes a temporal choropleth (one frame per period) rather
  // than N separate value columns. Only the area attempt uses the melted form;
  // points (handled above) and the table fallback keep the original shape.
  const wide = detectWide(columns);
  const aColumns = wide
    ? meltWide({ columns, rows }, wide, { periodName: "periodo", valueName: "valore" }).columns
    : columns;
  const aRows = wide
    ? meltWide({ columns, rows }, wide, { periodName: "periodo", valueName: "valore" }).rows
    : rows;

  const keys = await loadGeoKeys();
  const resolved =
    Object.keys(keys).length > 0 ? resolveGeoJoin(aColumns, aRows, keys) : null;
  let areaLevel: GeoLevel | null = null;
  let areaKey: string | null = null;
  if (resolved) {
    areaLevel = resolved.level;
    areaKey = resolved.keyColumn;
  } else {
    const detected = detectGeoLevel(aColumns);
    if (detected && GEO_LEVELS[detected].ready) {
      areaLevel = detected;
      areaKey = detectKeyColumn(detected, aColumns);
    }
  }

  if (areaLevel && areaKey) {
    // Temporal: the melted "periodo" column, or a detected period column in an
    // already-long table (e.g. comune,anno,valore). The period column is never
    // a measure, so it is excluded from the value candidates.
    const timeColumn = wide
      ? "periodo"
      : detectTimeColumn(aColumns, aRows, [areaKey]);
    const numericColumns = detectNumericColumns(aColumns, aRows).filter(
      (c) => c !== areaKey && c !== timeColumn,
    );
    if (numericColumns.length === 0) {
      return { error: "Nessuna colonna numerica da mappare trovata." };
    }
    const timeFrames = timeColumn ? framesOf(aRows, timeColumn) : undefined;
    // A sensible default category column for the category map: the first
    // categorical column that isn't the geo key (may be undefined).
    const categoryColumn = profileColumns(aColumns, aRows).columns.find(
      (c) => c.type === "categorical" && c.name !== areaKey && c.name !== timeColumn,
    )?.name;
    return {
      dataset: {
        kind: "area",
        fileName,
        columns: aColumns,
        rows: aRows,
        geoLevel: areaLevel,
        keyColumn: areaKey,
        valueColumn: numericColumns[0],
        categoryColumn,
        numericColumns,
        ...(timeColumn && timeFrames && timeFrames.length >= 2
          ? { timeColumn, timeFrames }
          : {}),
      },
    };
  }

  // No geography (no area key, no lat/lon): fall back to a plain table dataset.
  // It can't go on a map, but it feeds the chart pipeline (bar/line/area/
  // scatter) and the rich table. Need at least one numeric column to be useful.
  const numericColumns = detectNumericColumns(columns, rows);
  if (numericColumns.length === 0) {
    return {
      error:
        "Nessuna colonna numerica trovata: serve almeno una colonna di numeri " +
        "per fare un grafico, oppure una colonna geografica per una mappa.",
    };
  }
  const labelColumns = profile.columns
    .filter((c) => c.type !== "quantitative" && c.type !== "empty")
    .map((c) => c.name);
  return {
    dataset: {
      kind: "table",
      fileName,
      columns,
      rows,
      numericColumns,
      labelColumns,
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
  const [mode, setMode] = useState<DataMode>("home");

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

  // Home: pick a source, grouped by its nature (Zornade moat first).
  return (
    <PanelSection
      title="Da dove parti?"
      hint="Scegli i dati di partenza per la tua mappa."
    >
      <div className="space-y-5">
        {SOURCE_GROUPS.map((group) => (
          <div key={group.id}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {group.label}
              </p>
              {group.id === "zornade" && (
                <span className="rounded-full bg-zornade-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-zornade-700">
                  esclusivo
                </span>
              )}
            </div>
            <p className="mb-2 text-[11px] text-slate-400">{group.hint}</p>
            <div className="grid gap-2">
              {group.items.map((s) => {
                const Icon = s.icon;
                const isZornade = group.id === "zornade";
                const disabled = s.status === "soon";
                return (
                  <button
                    key={s.id}
                    disabled={disabled}
                    onClick={() => {
                      if (s.id === "catalog") setMode("catalog");
                      else setDataSource(s.id as never);
                    }}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                      disabled
                        ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
                        : isZornade
                          ? "border-zornade-200 bg-zornade-50/40 hover:border-zornade hover:shadow-sm"
                          : "border-slate-200 bg-white hover:border-zornade hover:shadow-sm"
                    }`}
                  >
                    <span
                      className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg ${
                        isZornade
                          ? "bg-zornade text-white"
                          : "bg-zornade-50 text-zornade-700"
                      }`}
                    >
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        {s.label}
                        {s.status === "soon" && <SoonBadge />}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {s.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
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

/** Italian label for the geometry primitives in a custom geometry dataset. */
function geoKindsLabel(kinds: ("polygon" | "line" | "point")[]): string {
  const map = { polygon: "aree", line: "linee", point: "punti" };
  return kinds.length > 0 ? kinds.map((k) => map[k]).join(", ") : "geometrie";
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
        // A GeoJSON with its own polygon/line geometry is drawn directly (geo);
        // a tabular GeoJSON (properties only) joins the bundled geometry as
        // before. Points stay on the existing tabular/point path.
        let geoFc: GeoJSON.FeatureCollection | null = null;
        try {
          const json = JSON.parse(text);
          if (hasDrawableGeometry(json)) geoFc = json as GeoJSON.FeatureCollection;
        } catch {
          /* not JSON → fall through to the tabular parser's error */
        }
        if (geoFc) {
          const { buildGeoDataset } = await import("../../lib/geo-dataset");
          out = buildGeoDataset(geoFc, file.name);
        } else {
          const parsed = parseGeoJson(text);
          out =
            "error" in parsed
              ? parsed
              : await buildDatasetFromTable(parsed, file.name);
        }
      } else if (name.endsWith(".zip") || name.endsWith(".shp")) {
        // Shapefile: geometry is the payload → a "geo" dataset drawn directly.
        const { parseShapefile } = await import("../../lib/ingest/parse-geometry");
        const { buildGeoDataset } = await import("../../lib/geo-dataset");
        const fc = await parseShapefile(
          await file.arrayBuffer(),
          name.endsWith(".zip"),
        );
        out = buildGeoDataset(fc, file.name);
      } else if (name.endsWith(".kml") || name.endsWith(".kmz")) {
        const { parseKml, parseKmz } = await import("../../lib/ingest/parse-geometry");
        const { buildGeoDataset } = await import("../../lib/geo-dataset");
        const fc = name.endsWith(".kmz")
          ? await parseKmz(await file.arrayBuffer())
          : await parseKml((await readFileSmart(file)).text);
        out = buildGeoDataset(fc, file.name);
      } else if (name.endsWith(".tif") || name.endsWith(".tiff")) {
        // GeoTIFF is raster, not vector — a different render path (in arrivo).
        setError(
          "Il GeoTIFF (raster) è in arrivo. Per ora: CSV, Excel, GeoJSON, Shapefile (.zip/.shp), KML e KMZ.",
        );
        return;
      } else {
        setError(
          "Formato non supportato. Usa CSV, Excel, GeoJSON, Shapefile (.zip), KML o KMZ.",
        );
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
              {data.kind === "area"
                ? `${data.rows.length} righe · livello ${GEO_LEVELS[data.geoLevel].label} · chiave “${data.keyColumn}”`
                : data.kind === "point"
                  ? `${data.rows.length} righe · punti (lat “${data.latColumn}”, lon “${data.lonColumn}”)`
                  : data.kind === "geo"
                    ? `${data.geojson.features.length} geometrie · ${geoKindsLabel(data.geometryKinds)}`
                    : `${data.rows.length} righe · tabella (per grafici)`}
            </p>
          </div>
        </div>

        {data.kind !== "table" &&
          (data.kind === "area" || data.numericColumns.length > 0) && (
          <Field
            label={data.kind === "area" ? "Colonna da mappare" : "Dimensione (opzionale)"}
          >
            <select
              value={data.valueColumn}
              onChange={(e) => setData({ ...data, valueColumn: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-zornade focus:outline-none"
            >
              {data.kind === "point" && <option value="">Nessuna (uniforme)</option>}
              {data.numericColumns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        )}

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
          CSV, Excel (.xlsx), GeoJSON, Shapefile (.zip), KML e KMZ · GeoTIFF in arrivo
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
  const { setData, setStep, project, updateProject } = useStudio();
  const [selected, setSelected] = useState<string | null>(null);
  const [catQuery, setCatQuery] = useState("");
  const [scopeKind, setScopeKind] = useState<"nationwide" | "comune" | "provincia" | "regione">("comune");
  const [placeName, setPlaceName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const preset = OSM_PRESETS.find((p) => p.id === selected) ?? null;
  const needsPlace = scopeKind !== "nationwide";
  const canSearch = !!preset && (!needsPlace || placeName.trim() !== "") && !loading;

  // Filter the category list by the search box (label, group or tag).
  const visiblePresets = useMemo(() => {
    const q = catQuery.trim().toLowerCase();
    if (q === "") return OSM_PRESETS;
    return OSM_PRESETS.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.group.toLowerCase().includes(q) ||
        p.tag.toLowerCase().includes(q),
    );
  }, [catQuery]);

  const search = async () => {
    if (!preset) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      // Resolve the scope to an Overpass area id. Nationwide uses Italy's area
      // directly; otherwise geocode the place name (fuzzy) via Nominatim — so
      // "Friuli" resolves to "Friuli-Venezia Giulia" instead of failing.
      let scope: OsmScope;
      let where = "Italia";
      if (scopeKind === "nationwide") {
        scope = { kind: "nationwide" };
      } else {
        const { geocodeArea } = await import("../../lib/nominatim");
        const area = await geocodeArea(placeName.trim(), scopeKind);
        if (!area) {
          setError(
            `Luogo “${placeName.trim()}” non trovato. Controlla il nome o cambia ambito.`,
          );
          return;
        }
        scope = { kind: "area", areaId: area.areaId };
        where = area.displayName.split(",")[0] || placeName.trim();
      }

      const query = buildOverpassQuery(preset.filters, scope);
      const elements = await runOverpass(query);
      const table = overpassToTable(elements, preset.filters);
      if (table.rows.length === 0) {
        setError(
          `Nessun “${preset.label.toLowerCase()}” trovato in ${where}. ` +
            "Prova un ambito più ampio o un'altra categoria.",
        );
        return;
      }
      setData({
        kind: "point",
        fileName: `OSM · ${preset.label}`,
        columns: table.columns,
        rows: table.rows,
        latColumn: "lat",
        lonColumn: "lon",
        valueColumn: "",
        categoryColumn: "categoria",
        nameColumn: "nome",
        numericColumns: [],
      });
      if (!project.title || project.title === "Mappa senza titolo") {
        updateProject({ title: `${preset.label} · ${where}` });
      }
      setInfo(
        `${table.rows.length} risultati in ${where}` +
          (table.dropped > 0 ? ` (${table.dropped} senza coordinate)` : "") +
          ".",
      );
      setStep("visualize");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore nella ricerca OSM.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium text-slate-600">Cosa cerchi?</p>
        <input
          value={catQuery}
          onChange={(e) => setCatQuery(e.target.value)}
          placeholder="Cerca una categoria (es. scuole, porti, musei)…"
          className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-zornade focus:outline-none"
        />
        <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
          {OSM_GROUPS.map((group) => {
            const items = visiblePresets.filter((p) => p.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {group}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelected(p.id)}
                      title={p.tag}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
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
            );
          })}
          {visiblePresets.length === 0 && (
            <p className="text-xs text-slate-400">Nessuna categoria trovata.</p>
          )}
        </div>
      </div>
      <Field label="Ambito">
        <select
          value={scopeKind}
          onChange={(e) =>
            setScopeKind(
              e.target.value as "nationwide" | "comune" | "provincia" | "regione",
            )
          }
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-zornade focus:outline-none"
        >
          <option value="comune">Per comune…</option>
          <option value="provincia">Per provincia…</option>
          <option value="regione">Per regione…</option>
          <option value="nationwide">Tutta Italia (può essere lento)</option>
        </select>
      </Field>
      {needsPlace && (
        <Field label="Nome del luogo">
          <input
            value={placeName}
            onChange={(e) => setPlaceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSearch) void search();
            }}
            placeholder={
              scopeKind === "comune"
                ? "es. Bologna"
                : scopeKind === "provincia"
                  ? "es. Udine"
                  : "es. Friuli"
            }
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-zornade focus:outline-none"
          />
        </Field>
      )}
      <Button
        variant="primary"
        disabled={!canSearch}
        onClick={() => void search()}
        className="w-full"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 size={15} className="animate-spin" />
            Ricerca su OpenStreetMap…
          </span>
        ) : (
          "Cerca su OpenStreetMap"
        )}
      </Button>
      {error && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          {error}
        </p>
      )}
      {info && (
        <p className="flex items-start gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" />
          {info}
        </p>
      )}
      <p className="text-xs text-slate-500">
        I risultati appaiono come punti sulla mappa. Dati © OpenStreetMap (ODbL).
      </p>
    </div>
  );
}

function ZornadeDbSource() {
  const { setData, setStep, updateProject } = useStudio();
  const [dataset, setDataset] = useState<string>("omi");
  // OMI options.
  const [semestre, setSemestre] = useState<string>("2025_2");
  const [tipologia, setTipologia] = useState<string>("20");
  const [market, setMarket] = useState<OmiMarket>("compravendita");
  // OMI: load all 22 semesters at once → time slider (animazione temporale).
  const [omiTemporal, setOmiTemporal] = useState(false);
  // Solar metric.
  const [metric, setMetric] = useState<string>(SOLAR_METRICS[0].id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const buildRequest = (): DbQueryRequest => {
    switch (dataset) {
      case "omi":
        return { dataset: "omi", semestre, tipologia, market, temporal: omiTemporal };
      case "solar":
        return { dataset: "solar", metric };
      case "population":
        return { dataset: "population" };
      default:
        return { dataset: "buildings" };
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const req = buildRequest();
      const rows = await queryZornadeDb(req);
      if (rows.length === 0) {
        setError("Nessun dato per questa selezione. Prova un'altra opzione.");
        return;
      }
      const meta = describeDbRequest(req);
      const table = dbRowsToTable(rows);
      const out = await buildDatasetFromTable(table, `Zornade · ${meta.title}`);
      if ("error" in out) {
        setError(out.error);
        return;
      }
      setData(out.dataset);
      updateProject({
        title: meta.title,
        source: "Fonte: dati Zornade · Fatto con Zornade Studio",
      });
      setInfo(`${rows.length} comuni caricati.`);
      setStep("visualize");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore di interrogazione.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-zornade-50 p-3">
        <p className="flex items-start gap-1.5 text-xs text-zornade-900">
          <ShieldCheck size={14} className="mt-0.5 flex-shrink-0" />
          Dati Zornade in <strong>sola lettura</strong> tramite un proxy sicuro.
          Le credenziali restano sul server, mai nel browser. Tutti i dataset
          sono per <strong>comune</strong> e si agganciano alla mappa dei comuni.
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-slate-600">Dataset</p>
        <div className="grid gap-2">
          {DB_DATASETS.map((d) => (
            <button
              key={d.id}
              onClick={() => setDataset(d.id)}
              className={`rounded-xl border p-2.5 text-left transition-colors ${
                dataset === d.id
                  ? "border-zornade bg-zornade-50"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <span className="text-sm font-medium text-slate-800">
                {d.label}
              </span>
              <span className="block text-xs text-slate-500">{d.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {dataset === "omi" && (
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <Field label="Mercato">
            <div className="flex gap-1.5">
              {(["compravendita", "locazione"] as OmiMarket[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMarket(m)}
                  className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium capitalize transition-colors ${
                    market === m
                      ? "border-zornade bg-zornade-50 text-zornade-700"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {m === "compravendita" ? "Compravendita" : "Affitto"}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Tipologia immobiliare">
            <select
              value={tipologia}
              onChange={(e) => setTipologia(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-zornade focus:outline-none"
            >
              {OMI_TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Semestre">
            <select
              value={semestre}
              onChange={(e) => setSemestre(e.target.value)}
              disabled={omiTemporal}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-zornade focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
            >
              {omiSemesters().map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " · sem. ")}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <input
              type="checkbox"
              checked={omiTemporal}
              onChange={(e) => setOmiTemporal(e.target.checked)}
              className="mt-0.5 accent-zornade"
            />
            <span className="text-xs text-slate-600">
              <strong>Tutti i semestri</strong> (2015→2025) per l'animazione
              temporale con time slider.
            </span>
          </label>
        </div>
      )}

      {dataset === "solar" && (
        <div className="rounded-xl border border-slate-200 p-3">
          <Field label="Indicatore">
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-zornade focus:outline-none"
            >
              {SOLAR_METRICS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.unit})
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <Button
        variant="primary"
        disabled={loading}
        onClick={() => void load()}
        className="w-full"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 size={15} className="animate-spin" />
            Interrogazione…
          </span>
        ) : (
          "Carica dal database Zornade"
        )}
      </Button>

      {error && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          {error}
        </p>
      )}
      {info && (
        <p className="flex items-start gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" />
          {info}
        </p>
      )}
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
