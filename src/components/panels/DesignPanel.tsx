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
  Plus,
  ChevronUp,
  ChevronDown,
  Camera,
  Navigation,
  Globe2,
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
  sameTool,
  type Annotation,
  type DrawTool,
} from "../../lib/annotations";
import { designCaps, supportsGlobe } from "../../studio/design-caps";
import { BIVARIATE_PALETTES, DEFAULT_BIVARIATE_PALETTE_ID } from "../../lib/bivariate";
import { MarkerStyleControls } from "./MarkerStyleControls";
import { useI18n } from "../../i18n/LanguageContext";
import type { Dictionary } from "../../i18n/dictionaries/it";

function usePresetOptions(dict: Dictionary): { id: PresetChoice; label: string }[] {
  return [
    ...NEWSROOM_KIT_LIST.map((k) => ({ id: k.id as PresetChoice, label: k.label })),
    { id: "custom", label: dict.designPanel.customPreset },
  ];
}

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
    vizType,
    annotations,
    annotationTool,
    setAnnotationTool,
    updateAnnotation,
    removeAnnotation,
    storySteps,
    addStoryStep,
    updateStoryStep,
    recaptureStoryStep,
    removeStoryStep,
    moveStoryStep,
    goToStep,
  } = useStudio();
  const { dict } = useI18n();
  const PRESET_OPTIONS = usePresetOptions(dict);

  const [noData, setNoData] = useState("#e5e7eb");
  const activeKit = preset !== "custom" ? NEWSROOM_KITS[preset] : null;
  // Cap classes at the number of source rows (each row can be its own class).
  const maxClasses = data ? Math.max(2, data.rows.length) : 9;
  // Capabilities for the active visualisation: each Design block renders only
  // when its capability is declared (lib/design-caps). Column bindings (geo
  // level/key, axes, value column) now live in the Struttura step.
  const caps = designCaps(vizType);
  // The globe projection applies to any map visualisation (not charts/table).
  const showGlobe = !!data && supportsGlobe(vizType, data.kind);
  const fontId =
    FONT_OPTIONS.find((f) => f.stack === design.titleFont)?.id ??
    "space-grotesk";

  const inputCls =
    "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-zornade focus:outline-none";

  return (
    <div className="space-y-6">
      {/* ---- Testi ---- */}
      <PanelSection title={dict.designPanel.textsTitle} hint={dict.designPanel.textsHint}>
        <Field label={dict.designPanel.titleLabel}>
          <input
            value={project.title}
            onChange={(e) => updateProject({ title: e.target.value })}
            className={inputCls}
          />
        </Field>
        <Field label={dict.designPanel.subtitleLabel}>
          <input
            value={project.subtitle}
            onChange={(e) => updateProject({ subtitle: e.target.value })}
            placeholder={dict.designPanel.subtitlePlaceholder}
            className={inputCls}
          />
        </Field>
        <Field label={dict.designPanel.sourceLabel}>
          <input
            value={project.source}
            onChange={(e) => updateProject({ source: e.target.value })}
            className={inputCls}
          />
        </Field>
        <div className="flex flex-wrap gap-3 pt-1">
          <Toggle
            label={dict.designPanel.toggleTitle}
            checked={design.showTitle}
            onChange={(v) => updateDesign({ showTitle: v })}
          />
          <Toggle
            label={dict.designPanel.toggleLegend}
            checked={design.showLegend}
            onChange={(v) => updateDesign({ showLegend: v })}
          />
          <Toggle
            label={dict.designPanel.toggleSource}
            checked={design.showSource}
            onChange={(v) => updateDesign({ showSource: v })}
          />
        </div>
      </PanelSection>

      {/* ---- Font & logo ---- */}
      <PanelSection title={dict.designPanel.fontLogoTitle} hint={dict.designPanel.fontLogoHint}>
        <Field label={dict.designPanel.titleFontLabel}>
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
                {dict.fontOptions[f.id] ?? f.label}
              </option>
            ))}
          </select>
        </Field>

        {fontId === "custom" && (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-zornade">
            <Upload size={15} />
            {dict.designPanel.uploadFont}
            <input
              type="file"
              accept=".woff2,.woff,.ttf,.otf"
              className="hidden"
            />
          </label>
        )}

        <Field label={dict.designPanel.logoLabel}>
          {activeKit?.logo && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <img
                src={activeKit.logo}
                alt={activeKit.label}
                className="h-6 w-auto object-contain"
              />
              <span className="text-xs text-slate-500">
                {dict.designPanel.logoOf(activeKit.label)}
              </span>
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-sm text-slate-600 hover:border-zornade">
            <ImageIcon size={15} />
            {activeKit?.logo ? dict.designPanel.replaceLogo : dict.designPanel.uploadLogo}
            <input type="file" accept=".png,.svg" className="hidden" />
          </label>
        </Field>
      </PanelSection>

      {/* ---- Brand ---- */}
      <PanelSection title={dict.designPanel.brandTitle}>
        <Field label={dict.designPanel.presetLabel}>
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

        <Field label={dict.designPanel.accentColorLabel}>
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
        title={dict.designPanel.basemapTitle}
        hint={dict.designPanel.basemapHint}
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
                <span className="flex-1">{dict.mapBasemaps[b.id] ?? b.label}</span>
                {soon && <SoonBadge />}
              </button>
            );
          })}
        </div>
        {design.basemap === "custom-raster" && (
          <Field
            label={dict.designPanel.customRasterUrlLabel}
            hint={dict.designPanel.customRasterUrlHint}
          >
            <input
              value={design.customBasemapUrl}
              onChange={(e) => updateDesign({ customBasemapUrl: e.target.value })}
              placeholder="https://…/{z}/{x}/{y}.png"
              className={inputCls}
            />
          </Field>
        )}
        {design.basemap === "sat-esri" && (
          <p className="text-[11px] text-slate-400">
            {dict.designPanel.satEsriNote}
          </p>
        )}
        <div className="flex flex-wrap gap-3 pt-2">
          <Toggle
            label={dict.designPanel.hideLabelsToggle}
            checked={design.hideLabels}
            onChange={(v) => updateDesign({ hideLabels: v })}
          />
        </div>
      </PanelSection>

      {/* ---- Proiezione (globo 3D) ---- */}
      {showGlobe && (
        <PanelSection
          title={dict.designPanel.projectionTitle}
          hint={dict.designPanel.projectionHint}
        >
          <button
            type="button"
            onClick={() => updateDesign({ globe: !design.globe })}
            aria-pressed={design.globe}
            className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
              design.globe
                ? "border-zornade bg-zornade-50"
                : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <Globe2
              size={18}
              className={design.globe ? "text-zornade-700" : "text-slate-500"}
            />
            <span className="flex-1">
              <span className="block text-sm font-medium text-slate-800">
                {dict.designPanel.globe3d}
              </span>
              <span className="block text-[11px] text-slate-500">
                {dict.designPanel.globe3dDesc}
              </span>
            </span>
            <span
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                design.globe ? "bg-zornade" : "bg-slate-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  design.globe ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </span>
          </button>
        </PanelSection>
      )}

      {/* ---- Opacità dati (globale) ---- */}
      {showGlobe && (
        <PanelSection
          title={dict.designPanel.dataOpacityTitle}
          hint={dict.designPanel.dataOpacityHint}
        >
          <Field label={dict.designPanel.opacityLabel(Math.round((design.dataOpacity ?? 1) * 100))}>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={design.dataOpacity ?? 1}
              onChange={(e) => updateDesign({ dataOpacity: Number(e.target.value) })}
              className="w-full accent-zornade"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              {dict.designPanel.opacityNote}
            </p>
          </Field>
        </PanelSection>
      )}

      {/* ---- Tipo di cartogramma ---- */}
      {caps.has("cartogramKind") && (
        <PanelSection
          title={dict.designPanel.cartogramTypeTitle}
          hint={dict.designPanel.cartogramTypeHint}
        >
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: "noncontiguous", label: dict.designPanel.noncontiguousLabel, desc: dict.designPanel.noncontiguousDesc },
              { id: "dorling", label: dict.designPanel.dorlingLabel, desc: dict.designPanel.dorlingDesc },
            ].map((o) => {
              const active = design.cartogramKind === o.id;
              return (
                <button
                  key={o.id}
                  onClick={() => updateDesign({ cartogramKind: o.id as "noncontiguous" | "dorling" })}
                  className={`flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-zornade bg-zornade-50 text-zornade-700"
                      : "border-slate-200 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  <span className="text-sm font-medium">{o.label}</span>
                  <span className="text-[11px] text-slate-500">{o.desc}</span>
                </button>
              );
            })}
          </div>
        </PanelSection>
      )}

      {/* ---- Esagerazione altezze (estrusione 3D) ---- */}
      {vizType === "extrusion" && (
        <PanelSection
          title={dict.designPanel.height3dTitle}
          hint={dict.designPanel.height3dHint}
        >
          <Field label={dict.designPanel.exaggerationLabel((design.extrusionScale ?? 1).toFixed(1))}>
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.1}
              value={design.extrusionScale ?? 1}
              onChange={(e) => updateDesign({ extrusionScale: Number(e.target.value) })}
              className="w-full accent-zornade"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              {dict.designPanel.exaggerationNote}
            </p>
          </Field>
        </PanelSection>
      )}

      {/* ---- Flussi: origine e destinazione ---- */}
      {caps.has("flowBinding") && data && (
        <PanelSection
          title={dict.designPanel.flowTitle}
          hint={dict.designPanel.flowHint}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={dict.designPanel.latOrigin}>
              <select
                value={design.flowFromLat}
                onChange={(e) => updateDesign({ flowFromLat: e.target.value })}
                className={inputCls}
              >
                <option value="">-</option>
                {data.numericColumns.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label={dict.designPanel.lonOrigin}>
              <select
                value={design.flowFromLon}
                onChange={(e) => updateDesign({ flowFromLon: e.target.value })}
                className={inputCls}
              >
                <option value="">-</option>
                {data.numericColumns.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label={dict.designPanel.latDest}>
              <select
                value={design.flowToLat}
                onChange={(e) => updateDesign({ flowToLat: e.target.value })}
                className={inputCls}
              >
                <option value="">-</option>
                {data.numericColumns.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label={dict.designPanel.lonDest}>
              <select
                value={design.flowToLon}
                onChange={(e) => updateDesign({ flowToLon: e.target.value })}
                className={inputCls}
              >
                <option value="">-</option>
                {data.numericColumns.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={dict.designPanel.intensityLabel} hint={dict.designPanel.intensityHint}>
            <select
              value={design.flowValue}
              onChange={(e) => updateDesign({ flowValue: e.target.value })}
              className={inputCls}
            >
              <option value="">{dict.structurePanel.noneOption}</option>
              {data.numericColumns.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
        </PanelSection>
      )}

      {/* ---- Grafico: etichette (gli assi sono nel passo Struttura) ---- */}
      {caps.has("chartAxes") && (
        <PanelSection
          title={dict.designPanel.chartTitle}
          hint={dict.designPanel.chartHint}
        >
          <Field label={dict.designPanel.yAxisNameLabel}>
            <input
              value={design.valueLabel}
              onChange={(e) => updateDesign({ valueLabel: e.target.value })}
              placeholder={design.chartY || dict.designPanel.valuePlaceholder}
              className={inputCls}
            />
          </Field>
          <Field label={dict.designPanel.unitLabel}>
            <input
              value={design.valueUnit}
              onChange={(e) => updateDesign({ valueUnit: e.target.value })}
              placeholder={dict.designPanel.unitPlaceholder}
              className={inputCls}
            />
          </Field>
          <Field label={dict.designPanel.colorScaleLabel}>
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
                    {(design.reverseScale ? [...s.colors].reverse() : s.colors).map((c) => (
                      <span key={c} className="flex-1" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="text-xs text-slate-600">{dict.colorScales[s.id] ?? s.label}</span>
                </button>
              ))}
            </div>
            <div className="pt-2">
              <Toggle
                label={dict.designPanel.reverseScaleToggle}
                checked={design.reverseScale}
                onChange={(v) => updateDesign({ reverseScale: v })}
              />
            </div>
          </Field>
          {vizType === "bar" && (
            <div className="pt-1">
              <Toggle
                label={dict.designPanel.sortByValueToggle}
                checked={design.chartSortByValue}
                onChange={(v) => updateDesign({ chartSortByValue: v })}
              />
            </div>
          )}
        </PanelSection>
      )}

      {/* ---- Dato: etichetta del valore mappato (mappe) ---- */}
      {caps.has("valueLabel") && data && data.kind !== "table" && (
        <PanelSection title={dict.designPanel.dataTitle} hint={dict.designPanel.dataHint}>
          <Field
            label={
              caps.has("bivariateBinding")
                ? dict.designPanel.firstValueNameLabel
                : dict.designPanel.valueNameLabel
            }
          >
            <input
              value={design.valueLabel}
              onChange={(e) => updateDesign({ valueLabel: e.target.value })}
              placeholder={data.valueColumn}
              className={inputCls}
            />
          </Field>
          <Field label={dict.designPanel.unitLabel}>
            <input
              value={design.valueUnit}
              onChange={(e) => updateDesign({ valueUnit: e.target.value })}
              placeholder={dict.designPanel.unitHint2}
              className={inputCls}
            />
          </Field>
          {caps.has("bivariateBinding") && (
            <>
              <Field label={dict.designPanel.secondValueNameLabel}>
                <input
                  value={design.valueLabel2}
                  onChange={(e) => updateDesign({ valueLabel2: e.target.value })}
                  placeholder={design.bivariateColumn2 || dict.designPanel.secondValuePlaceholderFallback}
                  className={inputCls}
                />
              </Field>
              <Field label={dict.designPanel.secondValueUnitLabel}>
                <input
                  value={design.valueUnit2}
                  onChange={(e) => updateDesign({ valueUnit2: e.target.value })}
                  placeholder={dict.designPanel.unitHint2}
                  className={inputCls}
                />
              </Field>
            </>
          )}
          <p className="text-[11px] text-slate-400">
            {caps.has("bivariateBinding")
              ? dict.designPanel.bivariateNote
              : dict.designPanel.singleValueNote}
          </p>
        </PanelSection>
      )}

      {/* ---- Colore: palette bivariata (matrice 3×3) ---- */}
      {caps.has("bivariateBinding") && (
        <PanelSection title={dict.designPanel.colorTitle} hint={dict.designPanel.bivariatePaletteHint}>
          <Field label={dict.designPanel.bivariatePaletteLabel}>
            <div className="space-y-1.5">
              {BIVARIATE_PALETTES.map((p) => {
                const selected =
                  (design.bivariatePalette || DEFAULT_BIVARIATE_PALETTE_ID) === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => updateDesign({ bivariatePalette: p.id })}
                    className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors ${
                      selected
                        ? "border-zornade bg-zornade-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <span
                      className="grid overflow-hidden rounded"
                      style={{
                        gridTemplateColumns: "repeat(3, 11px)",
                        gridTemplateRows: "repeat(3, 11px)",
                        gap: "1px",
                      }}
                    >
                      {[2, 1, 0].map((r) =>
                        [0, 1, 2].map((c) => (
                          <span
                            key={`${r}-${c}`}
                            style={{ background: p.colors[r * 3 + c] }}
                          />
                        )),
                      )}
                    </span>
                    <span className="text-xs text-slate-600">{dict.bivariatePalettes[p.id] ?? p.label}</span>
                  </button>
                );
              })}
            </div>
          </Field>
        </PanelSection>
      )}

      {/* ---- Colore: scala del dato (mappe) ---- */}
      {caps.has("colorScale") && !caps.has("chartAxes") && (
        <PanelSection title={dict.designPanel.colorTitle} hint={dict.designPanel.colorScaleOfDataHint}>
          <Field label={dict.designPanel.colorScaleLabel}>
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
                    {(design.reverseScale ? [...s.colors].reverse() : s.colors).map((c) => (
                      <span key={c} className="flex-1" style={{ background: c }} />
                    ))}
                  </span>
                  <span className="text-xs text-slate-600">{dict.colorScales[s.id] ?? s.label}</span>
                </button>
              ))}
            </div>
            <div className="pt-2">
              <Toggle
                label={dict.designPanel.reverseScaleToggle}
                checked={design.reverseScale}
                onChange={(v) => updateDesign({ reverseScale: v })}
              />
            </div>
          </Field>
        </PanelSection>
      )}

      {/* ---- Stile punti (punti / simboli / spike / densità) ---- */}
      {caps.has("pointStyle") && (
        <PanelSection
          title={dict.designPanel.pointStyleTitle}
          hint={dict.designPanel.pointStyleHint}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label={dict.designPanel.colorLabel}>
              <input
                type="color"
                value={design.pointColor}
                onChange={(e) => updateDesign({ pointColor: e.target.value })}
                className="h-9 w-full cursor-pointer rounded border border-slate-200"
              />
            </Field>
            <Field label={dict.designPanel.sizeLabel(design.pointSize)}>
              <input
                type="range"
                min={2}
                max={28}
                step={1}
                value={design.pointSize}
                onChange={(e) => updateDesign({ pointSize: Number(e.target.value) })}
                className="w-full accent-zornade"
              />
            </Field>
          </div>
        </PanelSection>
      )}

      {/* ---- Marker personalizzati (mappa localizzatore / punti) ---- */}
      {caps.has("markerStyle") && (
        <PanelSection
          title={dict.designPanel.markerTitle}
          hint={dict.designPanel.markerHint}
        >
          <MarkerStyleControls design={design} updateDesign={updateDesign} />
        </PanelSection>
      )}

      {/* ---- Classi e legenda (coropletica / geometria) ---- */}
      {caps.has("classification") && (
        <PanelSection
          title={dict.designPanel.classesLegendTitle}
          hint={dict.designPanel.classesLegendHint}
        >
          <Field label={dict.designPanel.classificationMethodLabel}>
            <select
              value={design.classification}
              onChange={(e) => updateDesign({ classification: e.target.value })}
              className={inputCls}
            >
              {CLASSIFICATION_METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {dict.classificationMethods[m.id] ?? m.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label={dict.designPanel.nClassesLabel(design.nClasses)}>
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
                {dict.designPanel.maxClassesNote(maxClasses, data.rows.length)}
              </p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={dict.designPanel.legendTypeLabel}>
              <select
                value={design.legendType}
                onChange={(e) => updateDesign({ legendType: e.target.value })}
                className={inputCls}
              >
                {LEGEND_TYPES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {dict.legendTypes[l.id] ?? l.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={dict.designPanel.noDataLabel}>
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
      <PanelSection title={dict.designPanel.interactivityTitle} hint={dict.designPanel.interactivityHint}>
        <div className="space-y-1.5">
          {INTERACTION_OPTIONS.map((o) => {
            const live = o.id === "tooltip" || o.id === "zoom";
            const checked =
              o.id === "tooltip"
                ? design.tooltip
                : o.id === "zoom"
                  ? design.zoomPan
                  : false;
            const opt = dict.interactionOptions[o.id] ?? o;
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
                    {opt.label}
                    {!live && <SoonBadge />}
                  </span>
                  <span className="block text-xs text-slate-500">{opt.desc}</span>
                </span>
              </label>
            );
          })}
        </div>
      </PanelSection>

      {/* ---- Annotazioni (O3.4) ---- */}
      <PanelSection
        title={dict.designPanel.annotationsTitle}
        hint={dict.designPanel.annotationsHint}
      >
        <div className="grid grid-cols-3 gap-2">
          {drawTools(dict).map((t) => {
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
              ? dict.designPanel.clickToPlacePoint
              : dict.designPanel.clickStartEnd}{" "}
            <span className="text-amber-600">{dict.designPanel.escToCancel}</span>
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
          <p className="text-xs text-slate-400">{dict.designPanel.noAnnotations}</p>
        )}
      </PanelSection>

      {/* ---- Scrollytelling (O4.1) ---- */}
      {data && !caps.has("chartAxes") && vizType !== "table" && (
        <PanelSection
          title={dict.designPanel.storyTitle}
          hint={dict.designPanel.storyHint}
        >
          <button
            onClick={addStoryStep}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-zornade bg-zornade-50 px-3 py-2 text-sm font-medium text-zornade-700 transition-colors hover:bg-zornade-100"
          >
            <Plus size={15} />
            {dict.designPanel.addStep}
          </button>
          {storySteps.length > 0 ? (
            <ol className="space-y-2">
              {storySteps.map((s, i) => (
                <li key={s.id} className="rounded-lg border border-slate-200 p-2.5">
                  <div className="mb-1.5 flex items-center gap-1">
                    <span className="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-zornade text-[11px] font-semibold text-white">
                      {i + 1}
                    </span>
                    <input
                      value={s.title}
                      onChange={(e) => updateStoryStep(s.id, { title: e.target.value })}
                      placeholder={dict.designPanel.stepTitlePlaceholder}
                      className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1 text-sm focus:border-zornade focus:outline-none"
                    />
                    <button onClick={() => moveStoryStep(s.id, -1)} disabled={i === 0} title={dict.designPanel.moveUp} className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30">
                      <ChevronUp size={14} />
                    </button>
                    <button onClick={() => moveStoryStep(s.id, 1)} disabled={i === storySteps.length - 1} title={dict.designPanel.moveDown} className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-30">
                      <ChevronDown size={14} />
                    </button>
                    <button onClick={() => removeStoryStep(s.id)} title={dict.designPanel.deleteAction} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <textarea
                    value={s.body}
                    onChange={(e) => updateStoryStep(s.id, { body: e.target.value })}
                    placeholder={dict.designPanel.stepBodyPlaceholder}
                    rows={2}
                    className="w-full resize-y rounded border border-slate-200 px-2 py-1 text-xs focus:border-zornade focus:outline-none"
                  />
                  <div className="mt-1.5 flex gap-2">
                    <button
                      onClick={() => goToStep(s.id)}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
                      title={dict.designPanel.goToStepTitle}
                    >
                      <Navigation size={12} /> {dict.designPanel.goToStep}
                    </button>
                    <button
                      onClick={() => recaptureStoryStep(s.id)}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100"
                      title={dict.designPanel.updateViewTitle}
                    >
                      <Camera size={12} /> {dict.designPanel.updateView}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-slate-400">
              {dict.designPanel.noSteps}
            </p>
          )}
        </PanelSection>
      )}
    </div>
  );
}

/** The annotation tools available in the design panel (O3.4). */
function drawTools(dict: Dictionary): {
  label: string;
  icon: typeof MapPin;
  tool: DrawTool;
}[] {
  return [
    { label: dict.designPanel.markerTool, icon: MapPin, tool: { kind: "marker" } },
    { label: dict.designPanel.textTool, icon: Type, tool: { kind: "text" } },
    { label: dict.designPanel.lineTool, icon: Minus, tool: { kind: "line", arrow: false } },
    { label: dict.designPanel.arrowTool, icon: MoveUpRight, tool: { kind: "line", arrow: true } },
    { label: dict.designPanel.rectangleTool, icon: Square, tool: { kind: "area", shape: "rectangle" } },
    { label: dict.designPanel.circleTool, icon: Circle, tool: { kind: "area", shape: "circle" } },
  ];
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
  const { dict } = useI18n();
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
          title={dict.designPanel.annotationColorTitle}
          className="h-6 w-6 flex-shrink-0 cursor-pointer rounded border border-slate-200 bg-white p-0"
        />
        <span className="flex-1 truncate text-xs font-medium text-slate-600">
          {annotationSummary(a)}
        </span>
        <button
          onClick={onRemove}
          title={dict.designPanel.annotationDeleteTitle}
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
          placeholder={a.type === "marker" ? dict.designPanel.annotationLabelPlaceholder : dict.designPanel.annotationTextPlaceholder}
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
