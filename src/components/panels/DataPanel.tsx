import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Upload,
  Info,
  CheckCircle2,
  AlertTriangle,
  Search,
  ExternalLink,
  Download,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Map,
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
import { GEO_LEVELS } from "../../lib/choropleth";
import { readFileSmart } from "../../lib/ingest/decode";
import { parseExcel } from "../../lib/ingest/parse-excel";
import { parseGeoJson } from "../../lib/ingest/parse-geojson";
import { titleFromFileName } from "../../lib/filename";
import { hasDrawableGeometry } from "../../lib/geo-dataset";
import { buildDatasetFromCsv, buildDatasetFromTable } from "../../lib/build-dataset";
import {
  buildOverpassQuery,
  runOverpass,
  runOverpassAdaptive,
  overpassToTable,
  type OsmScope,
} from "../../lib/overpass";
import {
  catalogApiAvailable,
  searchCkan,
  fetchResourceText,
  searchEurostat,
  fetchEurostatCsv,
  ITALIAN_PORTALS,
  EUROPEAN_PORTALS,
  type CkanDataset,
  type CkanResource,
  type EurostatSearchItem,
} from "../../lib/catalog-api";
import {
  EUROSTAT_DATASETS,
  EUROSTAT_THEMES,
  searchCurated,
  curatedByTheme,
  geoLabel,
  type EurostatDataset,
  type EurostatTheme,
} from "../../lib/eurostat-catalog";
import type { DatasetState, ProjectMeta } from "../../studio/types";
import { useI18n } from "../../i18n/LanguageContext";
import type { Dictionary } from "../../i18n/dictionaries/it";

type DataMode = "home" | "catalog-it" | "catalog-eu";
type CatalogScope = "italia" | "europa";

function applyDatasetMeta(
  updateProject: (patch: Partial<ProjectMeta>) => void,
  dataset: CkanDataset,
  dict: Dictionary,
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
  if (publisher) patch.source = dict.dataPanel.sourcePrefix(publisher);
  if (Object.keys(patch).length > 0) updateProject(patch);
}

export function DataPanel() {
  const { dataSource, setDataSource } = useStudio();
  const [mode, setMode] = useState<DataMode>("home");
  const { dict } = useI18n();

  // A concrete source (upload/osm/…) is selected → show its detail view.
  if (dataSource) {
    const meta = DATA_SOURCES.find((s) => s.id === dataSource);
    const metaText = meta ? dict.catalogItems[meta.id] : undefined;
    return (
      <div className="space-y-4">
        <button
          onClick={() => setDataSource(null)}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          {dict.dataPanel.changeSource}
        </button>
        <PanelSection title={metaText?.label ?? meta?.label ?? ""} hint={metaText?.desc ?? meta?.desc}>
          {dataSource === "upload" && <UploadSource />}
          {dataSource === "osm" && <OsmSource />}
          {dataSource === "eurostat" && <EurostatSource />}
          {(dataSource === "paste" ||
            dataSource === "url" ||
            dataSource === "api") && <ComingSoon />}
        </PanelSection>
      </div>
    );
  }

  if (mode === "catalog-it" || mode === "catalog-eu") {
    const scope: CatalogScope = mode === "catalog-eu" ? "europa" : "italia";
    return <DataCatalog scope={scope} onBack={() => setMode("home")} />;
  }

  // Home: pick a source, grouped by its nature.
  return (
    <PanelSection
      title={dict.dataPanel.whereFrom}
      hint={dict.dataPanel.whereFromHint}
    >
      <div className="space-y-5">
        {SOURCE_GROUPS.map((group) => {
          const groupText = dict.catalogGroups[group.id] ?? group;
          return (
          <div key={group.id}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {groupText.label}
              </p>
            </div>
            <p className="mb-2 text-[11px] text-slate-400">{groupText.hint}</p>
            <div className="grid gap-2">
              {group.items.map((s) => {
                const Icon = s.icon;
                const itemText = dict.catalogItems[s.id] ?? s;
                const disabled = s.status === "soon";
                return (
                  <button
                    key={s.id}
                    disabled={disabled}
                    onClick={() => {
                      if (s.id === "catalog-it") setMode("catalog-it");
                      else if (s.id === "catalog-eu") setMode("catalog-eu");
                      else setDataSource(s.id as never);
                    }}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                      disabled
                        ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
                        : "border-slate-200 bg-white hover:border-zornade hover:shadow-sm"
                    }`}
                  >
                    <span className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg bg-zornade-50 text-zornade-700">
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                        {itemText.label}
                        {s.status === "soon" && <SoonBadge />}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {itemText.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          );
        })}
      </div>
    </PanelSection>
  );
}

/* ------------------------------ Data catalog ------------------------------ */

function DataCatalog({
  scope,
  onBack,
}: {
  scope: CatalogScope;
  onBack: () => void;
}) {
  const [live, setLive] = useState<boolean | null>(null);
  const { dict } = useI18n();
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
          {dict.dataPanel.loadingCatalog}
        </div>
      </div>
    );
  }

  return live ? (
    <LiveCatalog scope={scope} onBack={onBack} />
  ) : (
    <CuratedCatalog onBack={onBack} />
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  const { dict } = useI18n();
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
    >
      <ArrowLeft size={14} />
      {dict.common.back}
    </button>
  );
}

/* --------------------------- Live catalog (CKAN) -------------------------- */

const PAGE_SIZE = 25;

function LiveCatalog({
  scope,
  onBack,
}: {
  scope: CatalogScope;
  onBack: () => void;
}) {
  const { dict } = useI18n();
  const portals = scope === "europa" ? EUROPEAN_PORTALS : ITALIAN_PORTALS;
  const [portal, setPortal] = useState(portals[0]?.id ?? "nazionale");
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
      setError(e instanceof Error ? e.message : dict.dataPanel.searchErrorGeneric);
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
        title={
          scope === "europa" ? dict.dataPanel.europeanOpenData : dict.dataPanel.italianOpenData
        }
        hint={dict.dataPanel.liveCatalogHint}
      >
        {/* Portal selector */}
        <Field label={dict.dataPanel.portalLabel}>
          <select
            value={portal}
            onChange={(e) => {
              setPortal(e.target.value);
              if (submitted) void runSearch(submitted, e.target.value, 0);
            }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-zornade focus:outline-none"
          >
            {portals.map((p) => (
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
            placeholder={dict.dataPanel.searchPlaceholderPortal}
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-zornade focus:outline-none focus:ring-2 focus:ring-zornade/20"
          />
        </form>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" />
            {dict.dataPanel.searching}
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
              {dict.dataPanel.datasetsFound(
                data.count.toLocaleString("it-IT"),
                submitted,
                data.results.length > 0 ? ` · ${from}–${to}` : "",
              )}
            </p>
            <div className="space-y-2">
              {data.results.map((d) => (
                <LiveDatasetCard key={d.id} dataset={d} />
              ))}
              {data.results.length === 0 && (
                <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
                  {dict.dataPanel.noLoadableDatasets}
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
                  {dict.dataPanel.previous}
                </button>
                <span className="text-[11px] text-slate-400">
                  {dict.dataPanel.pageOf(page + 1, totalPages.toLocaleString("it-IT"))}
                </span>
                <button
                  onClick={() => void runSearch(submitted, portal, page + 1)}
                  disabled={page + 1 >= totalPages}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {dict.dataPanel.next}
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </>
        )}

        {!loading && !data && !error && (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
            {dict.dataPanel.typeKeywordPrompt}
          </p>
        )}

        <p className="mt-1 text-[11px] text-slate-400">
          {dict.dataPanel.dataRemainsNote}
        </p>
      </PanelSection>
    </div>
  );
}

function LiveDatasetCard({ dataset }: { dataset: CkanDataset }) {
  const { setData, setStep, updateProject } = useStudio();
  const { dict } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadResource = async (r: CkanResource) => {
    if (r.format !== "CSV") {
      setError(dict.dataPanel.onlyCsvSupported(r.format));
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
      applyDatasetMeta(updateProject, dataset, dict);
      setStep("structure");
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.dataPanel.loadFailed);
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
                {r.name || dict.dataPanel.resourceFallbackName}
              </span>
              <button
                onClick={() => void loadResource(r)}
                disabled={busy === r.url}
                title={dict.dataPanel.loadToMapTitle}
                className="flex items-center gap-1 rounded-md bg-zornade px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-zornade-700 disabled:opacity-60"
              >
                {busy === r.url ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Download size={12} />
                )}
                {dict.dataPanel.loadAction}
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
            {dict.dataPanel.openSource}
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
  const { dict } = useI18n();
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
        {dict.common.back}
      </button>

      <PanelSection
        title={dict.dataPanel.catalogTitle}
        hint={dict.dataPanel.catalogHint}
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
            placeholder={dict.dataPanel.searchCatalogPlaceholder}
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
            {dict.dataPanel.allCategories}
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
                {dict.dataCategories[c.id] ?? c.label}
              </button>
            );
          })}
        </div>

        <p className="text-[11px] text-slate-400">
          {dict.dataPanel.sourcesFound(results.length)}
        </p>

        {/* Results */}
        <div className="space-y-2">
          {results.map((e) => (
            <DataCatalogCard key={e.id} entry={e} />
          ))}
          {results.length === 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
              {dict.dataPanel.noSourceFound}
            </p>
          )}
        </div>

        <p className="mt-2 text-[11px] text-slate-400">
          {dict.dataPanel.curatedCatalogNote(DATA_CATALOG.length)}
        </p>
      </PanelSection>
    </div>
  );
}

function DataCatalogCard({ entry }: { entry: DataSourceEntry }) {
  const { dict } = useI18n();
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
            {dict.accessLabels[a] ?? accessLabel(a)}
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

/** Localized label for the geometry primitives in a custom geometry dataset. */
function geoKindsLabel(kinds: ("polygon" | "line" | "point")[], dict: Dictionary): string {
  return kinds.length > 0
    ? kinds.map((k) => dict.geometryKinds[k]).join(", ")
    : dict.geometryKinds.fallback;
}

function UploadSource() {
  const { data, setData, setStep, project, updateProject } = useStudio();
  const { dict } = useI18n();
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
        // GeoTIFF is raster, not vector - a different render path (in arrivo).
        setError(dict.dataPanel.unsupportedGeoTiff);
        return;
      } else {
        setError(dict.dataPanel.unsupportedFormat);
        return;
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? dict.dataPanel.cannotReadFile(e.message)
          : dict.dataPanel.cannotReadFileGeneric,
      );
      return;
    }

    if ("error" in out) {
      setError(out.error);
      return;
    }
    setData(out.dataset);
    // Default the title from the file name (a file has no title metadata), only
    // if the operator hasn't already set one - never overwrite manual input.
    if (!project.title || project.title === "Mappa senza titolo") {
      const t = titleFromFileName(file.name);
      if (t) updateProject({ title: t });
    }
    // Don't pre-pick a viz: the next step is “Struttura”, where the operator
    // reviews/overrides how each column is used before choosing a chart.
    setStep("structure");
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
                ? dict.dataPanel.areaSummary(data.rows.length, dict.geoLevels[data.geoLevel] ?? GEO_LEVELS[data.geoLevel].label, data.keyColumn)
                : data.kind === "point"
                  ? dict.dataPanel.pointSummary(data.rows.length, data.latColumn, data.lonColumn)
                  : data.kind === "geo"
                    ? dict.dataPanel.geoSummary(data.geojson.features.length, geoKindsLabel(data.geometryKinds, dict))
                    : dict.dataPanel.tableSummary(data.rows.length)}
            </p>
          </div>
        </div>

        {data.kind !== "table" &&
          (data.kind === "area" || data.numericColumns.length > 0) && (
          <Field
            label={data.kind === "area" ? dict.dataPanel.columnToMap : dict.dataPanel.sizeOptional}
          >
            <select
              value={data.valueColumn}
              onChange={(e) => setData({ ...data, valueColumn: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-zornade focus:outline-none"
            >
              {data.kind === "point" && <option value="">{dict.dataPanel.noneUniform}</option>}
              {data.numericColumns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Button variant="secondary" onClick={() => setData(null)} className="w-full">
          {dict.dataPanel.loadAnotherFile}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition-colors hover:border-zornade hover:bg-zornade-50">
        <Upload size={22} className="text-slate-400" />
        <span className="text-sm font-medium text-slate-700">
          {dict.dataPanel.dropOrClick}
        </span>
        <span className="text-xs text-slate-500">
          {dict.dataPanel.supportedFormats}
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
        {dict.dataPanel.autoJoinNote}
      </p>
    </div>
  );
}

function OsmSource() {
  const { setData, setStep, project, updateProject, bboxPickMode: _bpm, setBboxPickMode, pendingBbox, setPendingBbox } = useStudio();
  const { dict } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const [catQuery, setCatQuery] = useState("");
  const [scopeMode, setScopeMode] = useState<"place" | "bbox">("place");
  // place mode
  const [placeName, setPlaceName] = useState("");
  // raw editable string kept in sync with pendingBbox (minLon,minLat,maxLon,maxLat)
  const [bboxRaw, setBboxRaw] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Activate/deactivate full-screen bbox picker on the right canvas
  useEffect(() => {
    if (scopeMode === "bbox") {
      setBboxPickMode(true);
    } else {
      setBboxPickMode(false);
      setPendingBbox(null);
    }
    return () => {
      setBboxPickMode(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeMode]);

  const preset = OSM_PRESETS.find((p) => p.id === selected) ?? null;

  // Validate a bbox string "minLon,minLat,maxLon,maxLat"
  const parseBboxRaw = (s: string): { south: number; west: number; north: number; east: number } | null => {
    const parts = s.trim().split(",").map((v) => parseFloat(v.trim()));
    if (parts.length !== 4 || parts.some(isNaN)) return null;
    const [west, south, east, north] = parts;
    if (south >= north || west >= east) return null;
    if (Math.abs(south) > 90 || Math.abs(north) > 90) return null;
    if (Math.abs(west) > 180 || Math.abs(east) > 180) return null;
    return { south, west, north, east };
  };

  // The effective bbox: drawn on map (context) OR parsed from the text field
  const effectiveBbox = pendingBbox ?? (bboxRaw ? parseBboxRaw(bboxRaw) : null);
  const bboxValid = scopeMode === "bbox" ? effectiveBbox !== null : true;
  const canSearch =
    !!preset &&
    !loading &&
    (scopeMode === "place" ? placeName.trim() !== "" : bboxValid);

  // When user draws a bbox on the full-screen map, update the text field to match
  const handleMapBbox = (bbox: { south: number; west: number; north: number; east: number }) => {
    setPendingBbox(bbox);
    setBboxRaw(`${bbox.west.toFixed(4)},${bbox.south.toFixed(4)},${bbox.east.toFixed(4)},${bbox.north.toFixed(4)}`);
  };

  // When user edits the text field manually, clear pendingBbox and re-parse
  const handleBboxRawChange = (s: string) => {
    setBboxRaw(s);
    const parsed = parseBboxRaw(s);
    setPendingBbox(parsed);
  };

  const resolvePlaceToBbox = async () => {
    const q = placeName.trim();
    if (!q) return;
    setResolving(true);
    setResolveError(null);
    try {
      const params = new URLSearchParams({
        q,
        format: "json",
        limit: "1",
        "accept-language": "en,it",
      });
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const results = (await res.json()) as Array<{
        boundingbox?: [string, string, string, string];
        display_name?: string;
      }>;
      if (!results.length || !results[0].boundingbox) {
        setResolveError(dict.dataPanel.placeNotFound(q));
        return;
      }
      const bb = results[0].boundingbox; // Nominatim: [south, north, west, east]
      const bbox = {
        south: parseFloat(bb[0]),
        north: parseFloat(bb[1]),
        west: parseFloat(bb[2]),
        east: parseFloat(bb[3]),
      };
      handleMapBbox(bbox);
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : dict.dataPanel.geocodingError);
    } finally {
      setResolving(false);
    }
  };

  // Filter the category list by the search box
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
      let elements;
      let where = "";

      const onProgress = (n: number) =>
        setInfo(dict.dataPanel.downloadingOsm(n));

      if (scopeMode === "bbox") {
        if (!effectiveBbox) {
          setError(dict.dataPanel.drawAreaOrCoords);
          return;
        }
        where = `bbox(${effectiveBbox.west.toFixed(2)},${effectiveBbox.south.toFixed(2)},${effectiveBbox.east.toFixed(2)},${effectiveBbox.north.toFixed(2)})`;
        elements = await runOverpassAdaptive(
          preset.filters,
          { bbox: effectiveBbox },
          { onProgress },
        );
      } else {
        // place mode: geocode to area id (supports worldwide)
        const { geocodeArea } = await import("../../lib/nominatim");
        const area = await geocodeArea(placeName.trim(), "area");
        if (!area) {
          setError(dict.dataPanel.placeNotFoundCheck(placeName.trim()));
          return;
        }
        where = area.displayName.split(",")[0] || placeName.trim();
        if (area.bbox) {
          // Tile the area's bounding box, clipping results to the boundary.
          elements = await runOverpassAdaptive(
            preset.filters,
            { bbox: area.bbox, areaId: area.areaId },
            { onProgress },
          );
        } else {
          // No bbox from Nominatim: fall back to a single area-id query.
          const scope: OsmScope = { kind: "area", areaId: area.areaId };
          elements = await runOverpass(buildOverpassQuery(preset.filters, scope));
        }
      }

      const table = overpassToTable(elements, preset.filters);
      if (table.rows.length === 0) {
        setError(dict.dataPanel.noResultsFound(preset.label.toLowerCase(), where));
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
        categoryColumn: dict.dataPanel.osmCategoryColumnName,
        nameColumn: dict.dataPanel.osmNameColumnName,
        numericColumns: [],
      });
      if (!project.title || project.title === dict.projectsModal.untitledMap) {
        updateProject({ title: `${preset.label} · ${where}` });
      }
      setInfo(
        dict.dataPanel.resultsInPlace(
          table.rows.length,
          where,
          table.dropped > 0 ? dict.dataPanel.droppedSuffix(table.dropped) : "",
        ),
      );
      setStep("structure");
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.dataPanel.osmSearchError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium text-slate-600">{dict.dataPanel.whatAreYouLookingFor}</p>
        <input
          value={catQuery}
          onChange={(e) => setCatQuery(e.target.value)}
          placeholder={dict.dataPanel.searchCategoryPlaceholder}
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
            <p className="text-xs text-slate-400">{dict.dataPanel.noCategoryFound}</p>
          )}
        </div>
      </div>

      {/* Scope mode selector */}
      <Field label={dict.dataPanel.searchArea}>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          <button
            onClick={() => setScopeMode("place")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              scopeMode === "place"
                ? "bg-white shadow-sm text-slate-800"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {dict.dataPanel.placeNameTab}
          </button>
          <button
            onClick={() => setScopeMode("bbox")}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              scopeMode === "bbox"
                ? "bg-white shadow-sm text-slate-800"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {dict.dataPanel.bboxTab}
          </button>
        </div>
      </Field>

      {scopeMode === "place" && (
        <Field label={dict.dataPanel.placeLabel} hint={dict.dataPanel.placeHint}>
          <input
            value={placeName}
            onChange={(e) => setPlaceName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSearch) void search();
            }}
            placeholder={dict.dataPanel.placePlaceholder}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-zornade focus:outline-none"
          />
        </Field>
      )}

      {scopeMode === "bbox" && (
        <div className="space-y-2">
          {/* Status callout */}
          <div className="flex items-start gap-2 rounded-lg border border-zornade/30 bg-zornade-50 px-3 py-2.5">
            <Map size={15} className="mt-0.5 flex-shrink-0 text-zornade-700" />
            <p className="text-xs text-zornade-800">
              {effectiveBbox
                ? dict.dataPanel.areaSelected(`${effectiveBbox.west.toFixed(2)},\u200b${effectiveBbox.south.toFixed(2)},\u200b${effectiveBbox.east.toFixed(2)},\u200b${effectiveBbox.north.toFixed(2)}`)
                : dict.dataPanel.clickDragMap}
            </p>
          </div>

          {/* Optional: find by name to auto-zoom */}
          <div className="flex gap-2">
            <input
              value={placeName}
              onChange={(e) => setPlaceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void resolvePlaceToBbox();
              }}
              placeholder={dict.dataPanel.findPlaceToCenter}
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-zornade focus:outline-none"
            />
            <button
              onClick={() => void resolvePlaceToBbox()}
              disabled={resolving || !placeName.trim()}
              className="flex-shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:border-slate-300 disabled:opacity-50"
            >
              {resolving ? <Loader2 size={13} className="animate-spin" /> : dict.dataPanel.find}
            </button>
          </div>

          {resolveError && (
            <p className="text-xs text-amber-700">{resolveError}</p>
          )}

          {/* Editable coordinate field - stays in sync with the drawn bbox */}
          <Field label={dict.dataPanel.coordinatesLabel} hint={dict.dataPanel.coordinatesHint}>
            <input
              value={bboxRaw}
              onChange={(e) => handleBboxRawChange(e.target.value)}
              placeholder={dict.dataPanel.coordinatesPlaceholder}
              className={`w-full rounded-lg border px-3 py-2 text-sm font-mono text-slate-700 focus:border-zornade focus:outline-none ${
                bboxRaw && !parseBboxRaw(bboxRaw)
                  ? "border-amber-300 bg-amber-50"
                  : "border-slate-200"
              }`}
            />
          </Field>
        </div>
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
            {dict.dataPanel.searchingInProgress}
          </span>
        ) : (
          dict.dataPanel.searchOsm
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
        {dict.dataPanel.osmResultsNote}
      </p>
    </div>
  );
}
function ComingSoon() {
  const { dict } = useI18n();
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-600">{dict.dataPanel.comingSoonTitle}</p>
      <p className="mt-1 text-xs text-slate-500">
        {dict.dataPanel.comingSoonBody}
      </p>
    </div>
  );
}


/* ──────────────────────────────── Eurostat ───────────────────────────────── */

type EurostatStep = "list" | "detail";

function EurostatSource() {
  const { setData, setStep, updateProject } = useStudio();
  const { dict } = useI18n();
  const [tab, setTab] = useState<"curated" | "search">("curated");
  const [themeFilter, setThemeFilter] = useState<EurostatTheme | "">("");
  const [localQ, setLocalQ] = useState("");
  const [innerStep, setInnerStep] = useState<EurostatStep>("list");
  const [selected, setSelected] = useState<EurostatDataset | null>(null);
  const [geo, setGeo] = useState<"paese" | "nuts2" | "nuts3">("nuts2");
  // Filtro paese opzionale - ISO-2 maiuscolo (es. "IT", "DE"). Vuoto = tutta l'UE.
  const [country, setCountry] = useState("IT");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [liveQ, setLiveQ] = useState("");
  const [liveSubmitted, setLiveSubmitted] = useState("");
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveResults, setLiveResults] = useState<{
    count: number;
    results: EurostatSearchItem[];
  } | null>(null);

  const curatedFiltered = useMemo(
    () =>
      themeFilter
        ? curatedByTheme(themeFilter)
        : localQ
          ? searchCurated(localQ)
          : EUROSTAT_DATASETS,
    [themeFilter, localQ],
  );

  const pickDataset = (ds: EurostatDataset) => {
    setSelected(ds);
    setGeo(ds.geo === "paese" ? "paese" : "nuts2");
    setCountry("IT");
    setLoadError(null);
    setInnerStep("detail");
  };

  const doLoad = async () => {
    if (!selected) return;
    setLoading(true);
    setLoadError(null);
    try {
      const csv = await fetchEurostatCsv(
        selected.code,
        geo,
        selected.defaultFilters ?? {},
        country,
      );
      const out = await buildDatasetFromCsv(csv, selected.label);
      if ("error" in out) {
        setLoadError(out.error);
        return;
      }
      setData(out.dataset);
      updateProject({
        title: selected.label,
        subtitle: selected.desc,
        source: dict.dataPanel.eurostatSourcePrefix(selected.code),
      });
      setStep("structure");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : dict.dataPanel.loadFailed);
    } finally {
      setLoading(false);
    }
  };

  const runLiveSearch = async (q: string) => {
    setLiveLoading(true);
    setLiveError(null);
    setLiveSubmitted(q);
    try {
      const res = await searchEurostat(q, 0, 30);
      setLiveResults(res);
    } catch (e) {
      setLiveError(e instanceof Error ? e.message : dict.dataPanel.searchErrorGeneric);
      setLiveResults(null);
    } finally {
      setLiveLoading(false);
    }
  };

  if (innerStep === "detail" && selected) {
    const geoOptions: Array<{ value: "paese" | "nuts2" | "nuts3"; label: string }> = [
      { value: "paese", label: dict.dataPanel.geoOptionCountry },
      ...(selected.geo !== "paese"
        ? [{ value: "nuts2" as const, label: dict.dataPanel.geoOptionNuts2 }]
        : []),
      ...(selected.geo === "nuts3"
        ? [{ value: "nuts3" as const, label: dict.dataPanel.geoOptionNuts3 }]
        : []),
    ];

    return (
      <div className="space-y-4">
        <button
          onClick={() => setInnerStep("list")}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          {dict.dataPanel.allDatasetsBack}
        </button>

        <PanelSection title={selected.label} hint={selected.desc}>
          <Field label={dict.dataPanel.geoGranularityLabel}>
            <select
              value={geo}
              onChange={(e) => setGeo(e.target.value as typeof geo)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-zornade focus:outline-none"
            >
              {geoOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={dict.dataPanel.countryLabel}
            hint={dict.dataPanel.countryHint}
          >
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
              placeholder="IT"
              maxLength={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono uppercase text-slate-700 focus:border-zornade focus:outline-none"
            />
          </Field>

          <div className="rounded-lg bg-slate-50 p-3 space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {dict.dataPanel.updatedNote(selected.updated, dict.eurostatGeoLabels[selected.geo] ?? geoLabel(selected.geo))}
            </p>
            <p className="text-[11px] text-slate-500">
              {dict.dataPanel.seriesNote(selected.timeRange[0], selected.timeRange[1])}
            </p>
          </div>

          {selected.columns.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium text-slate-600">{dict.dataPanel.columnsProduced}</p>
              <div className="space-y-1">
                {selected.columns.map((col) => (
                  <div key={col.name} className="flex items-start gap-2 text-xs">
                    <code className="flex-shrink-0 rounded bg-zornade-50 px-1.5 py-0.5 font-mono text-[11px] text-zornade-700">
                      {col.name}
                    </code>
                    <span className="text-slate-500">{col.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loadError && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              {loadError}
            </p>
          )}

          <Button onClick={() => void doLoad()} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {dict.dataPanel.loadingEllipsis}
              </>
            ) : (
              dict.dataPanel.loadIntoStudio
            )}
          </Button>

          <a
            href={selected.landing}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 text-xs text-slate-400 hover:text-zornade-700"
          >
            <ExternalLink size={12} />
            {dict.dataPanel.openOnEurostat}
          </a>
        </PanelSection>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        <button
          onClick={() => setTab("curated")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "curated"
              ? "bg-white shadow-sm text-slate-800"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {dict.dataPanel.curatedTab(EUROSTAT_DATASETS.length)}
        </button>
        <button
          onClick={() => setTab("search")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tab === "search"
              ? "bg-white shadow-sm text-slate-800"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {dict.dataPanel.searchAllTab}
        </button>
      </div>

      {tab === "curated" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => { setThemeFilter(""); setLocalQ(""); }}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                themeFilter === ""
                  ? "bg-zornade text-white"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
              }`}
            >
              {dict.dataPanel.allThemes}
            </button>
            {(
              Object.entries(EUROSTAT_THEMES) as [
                EurostatTheme,
                { label: string; icon: typeof Map },
              ][]
            ).map(([t, meta]) => (
              <button
                key={t}
                onClick={() => { setThemeFilter(t); setLocalQ(""); }}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  themeFilter === t
                    ? "bg-zornade text-white"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                <meta.icon size={12} className="flex-shrink-0" />
                {dict.eurostatThemes[t] ?? meta.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={localQ}
              onChange={(e) => { setLocalQ(e.target.value); setThemeFilter(""); }}
              placeholder={dict.dataPanel.searchCuratedPlaceholder}
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-zornade focus:outline-none focus:ring-2 focus:ring-zornade/20"
            />
          </div>

          <div className="space-y-2">
            {curatedFiltered.map((ds) => (
              <button
                key={ds.code}
                onClick={() => pickDataset(ds)}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition-all hover:border-zornade hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{ds.label}</p>
                    <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-zornade-700">
                      {(() => {
                        const Icon = EUROSTAT_THEMES[ds.theme].icon;
                        return <Icon size={11} className="flex-shrink-0" />;
                      })()}
                      {dict.eurostatThemes[ds.theme] ?? EUROSTAT_THEMES[ds.theme].label}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-500">{ds.desc}</p>
                  </div>
                  <span className="flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                    {ds.code}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
                  <span>{dict.eurostatGeoLabels[ds.geo] ?? geoLabel(ds.geo)}</span>
                  <span>&middot;</span>
                  <span>{ds.timeRange[0]}&ndash;{ds.timeRange[1]}</span>
                </div>
              </button>
            ))}
            {curatedFiltered.length === 0 && (
              <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
                {dict.dataPanel.noDatasetFound}
              </p>
            )}
          </div>
        </div>
      )}

      {tab === "search" && (
        <div className="space-y-3">
          <form
            onSubmit={(e) => { e.preventDefault(); void runLiveSearch(liveQ); }}
            className="relative"
          >
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={liveQ}
              onChange={(e) => setLiveQ(e.target.value)}
              placeholder={dict.dataPanel.searchEurostatPlaceholder}
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-zornade focus:outline-none focus:ring-2 focus:ring-zornade/20"
            />
          </form>

          {liveLoading && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-400">
              <Loader2 size={16} className="animate-spin" />
              {dict.dataPanel.searchingEurostatCatalog}
            </div>
          )}

          {liveError && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              {liveError}
            </p>
          )}

          {!liveLoading && liveResults && (
            <>
              <p className="text-[11px] text-slate-400">
                {dict.dataPanel.datasetsFoundFor(liveResults.count.toLocaleString("it-IT"), liveSubmitted)}
              </p>
              <div className="space-y-2">
                {liveResults.results.map((item) => {
                  const curated = EUROSTAT_DATASETS.find((d) => d.code === item.code);
                  return (
                    <button
                      key={item.code}
                      onClick={() =>
                        pickDataset(
                          curated ?? {
                            code: item.code,
                            label: item.label,
                            desc: item.label,
                            theme: "economia",
                            geo: "paese",
                            timeRange: [2000, 2024],
                            updated: "",
                            columns: [],
                            landing: `https://ec.europa.eu/eurostat/databrowser/view/${item.code}`,
                          },
                        )
                      }
                      className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition-all hover:border-zornade hover:shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-slate-800">{item.label}</p>
                        <span className="flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                          {item.code}
                        </span>
                      </div>
                      {curated && (
                        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-zornade-700">
                          {(() => {
                            const Icon = EUROSTAT_THEMES[curated.theme].icon;
                            return <Icon size={11} className="flex-shrink-0" />;
                          })()}
                          {dict.dataPanel.alreadyCurated}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {!liveLoading && !liveResults && !liveError && (
            <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-xs text-slate-400">
              {dict.dataPanel.searchEurostatPrompt}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
