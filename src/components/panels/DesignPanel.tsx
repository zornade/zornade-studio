import { useState } from "react";
import { Upload, Image as ImageIcon } from "lucide-react";
import { useStudio } from "../../studio/StudioContext";
import type { VariantName } from "../../basemap";
import {
  type PresetChoice,
  FONT_OPTIONS,
  COLOR_SCALES,
  MAP_FONTS,
  CLASSIFICATION_METHODS,
  LEGEND_TYPES,
  ANNOTATION_TOOLS,
  INTERACTION_OPTIONS,
  NEWSROOM_KIT_LIST,
  NEWSROOM_KITS,
} from "../../studio/catalog";
import { PanelSection, Field, SoonBadge } from "../primitives";

const PRESET_OPTIONS: { id: PresetChoice; label: string }[] = [
  ...NEWSROOM_KIT_LIST.map((k) => ({ id: k.id as PresetChoice, label: k.label })),
  { id: "custom", label: "Personalizzato" },
];

const VARIANTS: { id: VariantName; label: string }[] = [
  { id: "positron", label: "Positron" },
  { id: "carta", label: "Carta" },
  { id: "ardesia", label: "Ardesia" },
  { id: "inchiostro", label: "Inchiostro" },
];

export function DesignPanel() {
  const {
    project,
    updateProject,
    brand,
    preset,
    applyPreset,
    updateBrand,
    design,
    updateDesign,
    data,
  } = useStudio();

  const [noData, setNoData] = useState("#e5e7eb");
  const activeKit = preset !== "custom" ? NEWSROOM_KITS[preset] : null;
  // Cap classes at the number of source rows (each row can be its own class).
  const maxClasses = data ? Math.max(2, data.rows.length) : 9;
  const fontId =
    FONT_OPTIONS.find((f) => f.stack === design.titleFont)?.id ??
    "space-grotesk";

  const inputCls =
    "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-zornade focus:outline-none";

  return (
    <div className="space-y-6">
      {/* ---- Testi ---- */}
      <PanelSection title="Testi" hint="Titolo, sottotitolo e fonte della mappa.">
        <Field label="Titolo">
          <input
            value={project.title}
            onChange={(e) => updateProject({ title: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label="Sottotitolo">
          <input
            value={project.subtitle}
            onChange={(e) => updateProject({ subtitle: e.target.value })}
            placeholder="Aggiungi un sottotitolo…"
            className={inputCls}
          />
        </Field>
        <Field label="Fonte">
          <input
            value={project.source}
            onChange={(e) => updateProject({ source: e.target.value })}
            className={inputCls}
          />
        </Field>
        <div className="flex flex-wrap gap-3 pt-1">
          <Toggle
            label="Titolo"
            checked={design.showTitle}
            onChange={(v) => updateDesign({ showTitle: v })}
          />
          <Toggle
            label="Legenda"
            checked={design.showLegend}
            onChange={(v) => updateDesign({ showLegend: v })}
          />
          <Toggle
            label="Fonte"
            checked={design.showSource}
            onChange={(v) => updateDesign({ showSource: v })}
          />
        </div>
      </PanelSection>

      {/* ---- Font & logo ---- */}
      <PanelSection title="Font & logo" hint="Personalizza l'identità della redazione.">
        <Field label="Font dei titoli">
          <select
            value={fontId}
            onChange={(e) => {
              const opt = FONT_OPTIONS.find((f) => f.id === e.target.value);
              if (opt) updateDesign({ titleFont: opt.stack });
            }}
            className={inputCls}
            style={{ fontFamily: design.titleFont }}
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>

        {fontId === "custom" && (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-zornade">
            <Upload size={15} />
            Carica font (.woff2, .ttf)
            <input
              type="file"
              accept=".woff2,.woff,.ttf,.otf"
              className="hidden"
            />
          </label>
        )}

        <Field label="Font etichette mappa">
          <select
            value={design.mapFont}
            onChange={(e) => updateDesign({ mapFont: e.target.value })}
            className={inputCls}
          >
            {MAP_FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Logo">
          {activeKit?.logo && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <img
                src={activeKit.logo}
                alt={activeKit.label}
                className="h-6 w-auto object-contain"
              />
              <span className="text-xs text-slate-500">
                Logo {activeKit.label}
              </span>
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-zornade">
            <ImageIcon size={15} />
            {activeKit?.logo ? "Sostituisci logo (PNG/SVG)" : "Carica logo (PNG/SVG)"}
            <input type="file" accept=".png,.svg" className="hidden" />
          </label>
        </Field>
      </PanelSection>

      {/* ---- Brand ---- */}
      <PanelSection title="Brand della redazione">
        <Field label="Preset">
          <select
            value={preset}
            onChange={(e) => applyPreset(e.target.value as PresetChoice)}
            className={inputCls}
          >
            {PRESET_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Colore d'accento">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={brand.accent}
              onChange={(e) => updateBrand({ accent: e.target.value })}
              className="h-9 w-12 cursor-pointer rounded border border-slate-200"
            />
            <input
              value={brand.accent}
              onChange={(e) => updateBrand({ accent: e.target.value })}
              className="w-28 rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-zornade focus:outline-none"
            />
          </div>
        </Field>
      </PanelSection>

      {/* ---- Stile mappa ---- */}
      <PanelSection title="Stile della mappa">
        <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={design.showBasemap}
            onChange={(e) => updateDesign({ showBasemap: e.target.checked })}
            className="h-4 w-4 rounded accent-zornade"
          />
          Mostra la mappa di sfondo
          <span className="ml-auto text-xs text-slate-400">
            {design.showBasemap ? "" : "sfondo trasparente"}
          </span>
        </label>

        {design.showBasemap && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {VARIANTS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => updateBrand({ variant: v.id })}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    brand.variant === v.id
                      ? "border-zornade bg-zornade-50 text-zornade-700"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            <Field
              label={`Intensità tinta · ${Math.round((brand.tintStrength ?? 0.35) * 100)}%`}
            >
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={brand.tintStrength ?? 0.35}
                onChange={(e) =>
                  updateBrand({ tintStrength: Number(e.target.value) })
                }
                className="w-full accent-zornade"
              />
            </Field>

            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={brand.tintWater ?? false}
                onChange={(e) => updateBrand({ tintWater: e.target.checked })}
                className="h-4 w-4 rounded accent-zornade"
              />
              Tinta anche l'acqua
            </label>
          </>
        )}
      </PanelSection>

      {/* ---- Colori dei dati ---- */}
      <PanelSection
        title="Colori dei dati"
        hint="Scala, classi e legenda della coropletica."
      >
        {data && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label="Nome del dato in mappa">
              <input
                value={design.valueLabel}
                onChange={(e) => updateDesign({ valueLabel: e.target.value })}
                placeholder={data.valueColumn}
                className={inputCls}
              />
            </Field>
            <Field label="Unità">
              <input
                value={design.valueUnit}
                onChange={(e) => updateDesign({ valueUnit: e.target.value })}
                placeholder="es. %"
                className={`${inputCls} w-20`}
              />
            </Field>
          </div>
        )}

        <Field label="Scala colore">
          <div className="space-y-1.5">
            {COLOR_SCALES.map((s) => (
              <button
                key={s.id}
                onClick={() => updateDesign({ colorScale: s.id })}
                className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
                  design.colorScale === s.id
                    ? "border-zornade bg-zornade-50"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <span className="flex h-3.5 w-24 overflow-hidden rounded-full">
                  {s.colors.map((c) => (
                    <span key={c} className="flex-1" style={{ background: c }} />
                  ))}
                </span>
                <span className="text-xs text-slate-600">{s.label}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Metodo di classificazione">
          <select
            value={design.classification}
            onChange={(e) => updateDesign({ classification: e.target.value })}
            className={inputCls}
          >
            {CLASSIFICATION_METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={`Numero di classi · ${design.nClasses}`}>
          <input
            type="range"
            min={2}
            max={maxClasses}
            step={1}
            value={Math.min(design.nClasses, maxClasses)}
            onChange={(e) => updateDesign({ nClasses: Number(e.target.value) })}
            className="w-full accent-zornade"
          />
          {data && (
            <p className="mt-1 text-[11px] text-slate-400">
              Fino a {maxClasses} classi ({data.rows.length} righe nel file).
            </p>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo di legenda">
            <select
              value={design.legendType}
              onChange={(e) => updateDesign({ legendType: e.target.value })}
              className={inputCls}
            >
              {LEGEND_TYPES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nessun dato">
            <input
              type="color"
              value={noData}
              onChange={(e) => setNoData(e.target.value)}
              className="h-9 w-full cursor-pointer rounded border border-slate-200"
            />
          </Field>
        </div>
      </PanelSection>

      {/* ---- Interattività ---- */}
      <PanelSection title="Interattività" hint="Cosa può fare il lettore con la mappa pubblicata.">
        <div className="space-y-1.5">
          {INTERACTION_OPTIONS.map((o) => {
            const live = o.id === "tooltip" || o.id === "zoom";
            const checked =
              o.id === "tooltip"
                ? design.tooltip
                : o.id === "zoom"
                  ? design.zoomPan
                  : false;
            return (
              <label
                key={o.id}
                className={`flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2 ${
                  live ? "cursor-pointer hover:border-zornade" : "opacity-70"
                }`}
              >
                <input
                  type="checkbox"
                  disabled={!live}
                  checked={live ? checked : false}
                  onChange={(e) => {
                    if (o.id === "tooltip")
                      updateDesign({ tooltip: e.target.checked });
                    else if (o.id === "zoom")
                      updateDesign({ zoomPan: e.target.checked });
                  }}
                  className="mt-0.5 h-4 w-4 rounded accent-zornade"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    {o.label}
                    {!live && <SoonBadge />}
                  </span>
                  <span className="block text-xs text-slate-500">{o.desc}</span>
                </span>
              </label>
            );
          })}
        </div>
      </PanelSection>

      {/* ---- Annotazioni (mockup) ---- */}
      <PanelSection title="Annotazioni">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <SoonBadge />
          Aggiungi elementi sopra la mappa.
        </div>
        <div className="grid grid-cols-2 gap-2">
          {ANNOTATION_TOOLS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                disabled
                className="flex cursor-not-allowed items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500 opacity-70"
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </div>
      </PanelSection>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded accent-zornade"
      />
      {label}
    </label>
  );
}
