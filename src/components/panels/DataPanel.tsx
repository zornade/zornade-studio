import { useMemo, useState } from "react";
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
} from "../../lib/choropleth";

type DataMode = "home" | "catalog" | "own";

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
  const { data, setData, setVizType, setStep } = useStudio();
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    const name = file.name.toLowerCase();
    if (!name.endsWith(".csv")) {
      setError(
        "Per ora è supportato il CSV. Excel/GeoJSON/Shapefile sono in arrivo.",
      );
      return;
    }
    const text = await file.text();
    const { columns, rows } = parseCsv(text);
    if (columns.length === 0 || rows.length === 0) {
      setError("Il file sembra vuoto o non leggibile.");
      return;
    }
    const geoLevel = detectGeoLevel(columns);
    if (!geoLevel) {
      setError(
        "Nessuna colonna geografica riconosciuta (es. codice_istat, sigla, comune).",
      );
      return;
    }
    if (!GEO_LEVELS[geoLevel].ready) {
      setError(
        `Livello “${GEO_LEVELS[geoLevel].label}” riconosciuto, ma la geometria non è ancora disponibile. Per ora: Regioni.`,
      );
      return;
    }
    const keyColumn = detectKeyColumn(geoLevel, columns)!;
    const numericColumns = detectNumericColumns(columns, rows).filter(
      (c) => c !== keyColumn,
    );
    if (numericColumns.length === 0) {
      setError("Nessuna colonna numerica da mappare trovata.");
      return;
    }
    setData({
      fileName: file.name,
      columns,
      rows,
      geoLevel,
      keyColumn,
      valueColumn: numericColumns[0],
      numericColumns,
    });
    setVizType("choropleth");
    setStep("design");
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
          CSV (Excel, GeoJSON, Shapefile, KML, GeoTIFF in arrivo)
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
