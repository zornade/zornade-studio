import { useState } from "react";
import {
  Upload,
  Image as ImageIcon,
  MapPin,
  Type,
  Minus,
  MoveUpRight,
  Square,
  Circle,
  Trash2,
} from "lucide-react";
import { useStudio } from "../../studio/StudioContext";
import {
  type PresetChoice,
  FONT_OPTIONS,
  COLOR_SCALES,
  MAP_BASEMAPS,
  CLASSIFICATION_METHODS,
  LEGEND_TYPES,
  INTERACTION_OPTIONS,
  NEWSROOM_KIT_LIST,
  NEWSROOM_KITS,
} from "../../studio/catalog";
import { PanelSection, Field, SoonBadge } from "../primitives";
import {
  annotationSummary,
  type Annotation,
  type DrawTool,
} from "../../lib/annotations";
import { isChartType } from "../../lib/chart-data";

const PRESET_OPTIONS: { id: PresetChoice; label: string }[] = [
  ...NEWSROOM_KIT_LIST.map((k) => ({ id: k.id as PresetChoice, label: k.label })),
  { id: "custom", label: "Personalizzato" },
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
    setData,
    vizType,
    annotations,
    annotationTool,
    setAnnotationTool,
    updateAnnotation,
    removeAnnotation,
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
      <PanelSection
        title="Mappa di sfondo"
        hint="Tiles OpenFreeMap (nessuna chiave, dati © OpenStreetMap)."
      >
        <div className="space-y-1.5">
          {MAP_BASEMAPS.map((b) => {
            const soon = b.status === "soon";
            const active = design.basemap === b.id;
            return (
              <button
                key={b.id}
                disabled={soon}
                onClick={() => updateDesign({ basemap: b.id })}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? "border-zornade bg-zornade-50 text-zornade-700"
                    : "border-slate-200 text-slate-600 hover:border-slate-300"
                } ${soon ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <span className="flex-1">{b.label}</span>
                {soon && <SoonBadge />}
              </button>
            );
          })}
        </div>
      </PanelSection>

      {/* ---- Assi del grafico (solo per i grafici) ---- */}
      {data && isChartType(vizType) && (
        <PanelSection
          title="Assi del grafico"
          hint="Scegli le colonne per gli assi e le serie."
        >
          <Field label={vizType === "scatter" ? "Asse X (numerico)" : "Asse X (categoria)"}>
            <select
              value={design.chartX}
              onChange={(e) => updateDesign({ chartX: e.target.value })}
              className={inputCls}
            >
              <option value="">— automatico —</option>
              {data.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Asse Y (valore)">
            <select
              value={design.chartY}
              onChange={(e) => updateDesign({ chartY: e.target.value })}
              className={inputCls}
            >
              <option value="">— automatico —</option>
              {data.numericColumns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Serie / colore (opzionale)">
            <select
              value={design.chartSeries}
              onChange={(e) => updateDesign({ chartSeries: e.target.value })}
              className={inputCls}
            >
              <option value="">— nessuna —</option>
              {data.columns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nome dell'asse Y (opzionale)">
            <input
              value={design.valueLabel}
              onChange={(e) => updateDesign({ valueLabel: e.target.value })}
              placeholder={design.chartY || "valore"}
              className={inputCls}
            />
          </Field>
          <Field label="Unità di misura (opzionale)">
            <input
              value={design.valueUnit}
              onChange={(e) => updateDesign({ valueUnit: e.target.value })}
              placeholder="es. %, €, GWh, ab."
              className={inputCls}
            />
          </Field>
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
          {vizType === "bar" && (
            <div className="pt-1">
              <Toggle
                label="Ordina per valore"
                checked={design.chartSortByValue}
                onChange={(v) => updateDesign({ chartSortByValue: v })}
              />
            </div>
          )}
        </PanelSection>
      )}

      {/* ---- Dato, colori e legenda (solo per le mappe) ---- */}
      {!isChartType(vizType) && vizType !== "table" && (
      <PanelSection
        title="Dato e legenda"
        hint="Etichetta del dato, scala colore, classi e legenda."
      >
        {data && data.kind !== "table" && (
          <>
            <Field label="Colonna da mappare">
              <select
                value={data.valueColumn}
                onChange={(e) =>
                  setData({ ...data, valueColumn: e.target.value })
                }
                className={inputCls}
              >
                {data.numericColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nome del dato in mappa">
              <input
                value={design.valueLabel}
                onChange={(e) => updateDesign({ valueLabel: e.target.value })}
                placeholder={data.valueColumn}
                className={inputCls}
              />
            </Field>
            <Field label="Unità di misura (opzionale)">
              <input
                value={design.valueUnit}
                onChange={(e) => updateDesign({ valueUnit: e.target.value })}
                placeholder="es. %, €/m², ab/km²"
                className={inputCls}
              />
            </Field>
          </>
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
      )}

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

      {/* ---- Annotazioni (O3.4) ---- */}
      <PanelSection
        title="Annotazioni"
        hint="Aggiungi elementi sopra la mappa: si ancorano al punto geografico."
      >
        <div className="grid grid-cols-3 gap-2">
          {DRAW_TOOLS.map((t) => {
            const Icon = t.icon;
            const active = sameTool(annotationTool, t.tool);
            return (
              <button
                key={t.label}
                onClick={() => setAnnotationTool(active ? null : t.tool)}
                className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-xs transition-colors ${
                  active
                    ? "border-zornade bg-zornade/10 text-zornade"
                    : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <Icon size={16} />
                {t.label}
              </button>
            );
          })}
        </div>

        {annotationTool && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {annotationTool.kind === "marker" || annotationTool.kind === "text"
              ? "Clicca sulla mappa per posizionare."
              : "Clicca il punto iniziale e poi quello finale."}{" "}
            <span className="text-amber-600">Esc per annullare.</span>
          </p>
        )}

        {annotations.length > 0 ? (
          <ul className="space-y-1.5">
            {annotations.map((a) => (
              <AnnotationRow
                key={a.id}
                annotation={a}
                onChange={(patch) => updateAnnotation(a.id, patch)}
                onRemove={() => removeAnnotation(a.id)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-400">Nessuna annotazione.</p>
        )}
      </PanelSection>
    </div>
  );
}

/** The annotation tools available in the design panel (O3.4). */
const DRAW_TOOLS: {
  label: string;
  icon: typeof MapPin;
  tool: DrawTool;
}[] = [
  { label: "Marker", icon: MapPin, tool: { kind: "marker" } },
  { label: "Testo", icon: Type, tool: { kind: "text" } },
  { label: "Linea", icon: Minus, tool: { kind: "line", arrow: false } },
  { label: "Freccia", icon: MoveUpRight, tool: { kind: "line", arrow: true } },
  { label: "Rettangolo", icon: Square, tool: { kind: "area", shape: "rectangle" } },
  { label: "Cerchio", icon: Circle, tool: { kind: "area", shape: "circle" } },
];

/** Structural equality for two draw tools (sub-variants included). */
function sameTool(a: DrawTool | null, b: DrawTool): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === "line" && b.kind === "line") return a.arrow === b.arrow;
  if (a.kind === "area" && b.kind === "area") return a.shape === b.shape;
  return true;
}

/** One editable row for an annotation: summary, colour, optional text, delete. */
function AnnotationRow({
  annotation,
  onChange,
  onRemove,
}: {
  annotation: Annotation;
  onChange: (patch: Partial<Annotation>) => void;
  onRemove: () => void;
}) {
  const a = annotation;
  const textValue =
    a.type === "marker" ? a.label : a.type === "text" ? a.text : "";
  const editsText = a.type === "marker" || a.type === "text";
  return (
    <li className="rounded-lg border border-slate-200 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={a.color}
          onChange={(e) => onChange({ color: e.target.value } as Partial<Annotation>)}
          title="Colore"
          className="h-6 w-6 flex-shrink-0 cursor-pointer rounded border border-slate-200 bg-white p-0"
        />
        <span className="flex-1 truncate text-xs font-medium text-slate-600">
          {annotationSummary(a)}
        </span>
        <button
          onClick={onRemove}
          title="Elimina"
          className="flex-shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 size={14} />
        </button>
      </div>
      {editsText && (
        <input
          type="text"
          value={textValue}
          onChange={(e) =>
            onChange(
              (a.type === "marker"
                ? { label: e.target.value }
                : { text: e.target.value }) as Partial<Annotation>,
            )
          }
          placeholder={a.type === "marker" ? "Etichetta (facoltativa)" : "Testo"}
          className="mt-1.5 w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-zornade focus:outline-none"
        />
      )}
    </li>
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
