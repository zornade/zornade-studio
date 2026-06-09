import { useState } from "react";
import { ArrowLeft, Upload, ShieldCheck, Info } from "lucide-react";
import { useStudio } from "../../studio/StudioContext";
import {
  DATA_SOURCES,
  OSM_PRESETS,
  ZORNADE_DATASETS,
} from "../../studio/catalog";
import { Button, PanelSection, SoonBadge, Field } from "../primitives";

export function DataPanel() {
  const { dataSource, setDataSource } = useStudio();

  if (!dataSource) {
    return (
      <PanelSection
        title="Da dove arrivano i dati?"
        hint="Scegli una sorgente per iniziare la tua mappa."
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
    );
  }

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

function UploadSource() {
  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition-colors hover:border-zornade hover:bg-zornade-50">
        <Upload size={22} className="text-slate-400" />
        <span className="text-sm font-medium text-slate-700">
          Trascina un file o clicca per caricare
        </span>
        <span className="text-xs text-slate-500">
          CSV, Excel, GeoJSON, Shapefile, KML, GeoTIFF
        </span>
        <input
          type="file"
          accept=".csv,.xlsx,.geojson,.json,.zip,.kml,.kmz,.tif,.tiff"
          className="hidden"
        />
      </label>
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
