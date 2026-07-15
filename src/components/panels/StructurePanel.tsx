import { useEffect, useState } from "react";
import { Map as MapIcon, MapPin, Table2 } from "lucide-react";
import { useStudio } from "../../studio/StudioContext";
import { PanelSection, Field } from "../primitives";
import { DataTableView, type BadgeRole } from "../DataTableView";
import {
  mappingFromDataset,
  applyMapping,
  kindsAvailable,
  roleOf,
  type DatasetMapping,
  type DatasetKind,
} from "../../lib/mapping";
import { detectNumericColumns } from "../../lib/csv";
import { GEO_LEVELS, type GeoLevel } from "../../lib/choropleth";
import { useI18n } from "../../i18n/LanguageContext";

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-zornade focus:outline-none";

const KIND_ICON: Record<DatasetKind, typeof MapIcon> = {
  area: MapIcon,
  point: MapPin,
  geo: MapIcon,
  table: Table2,
};

/** A <select> wired to a string value. "" represents an unset/automatic value. */
function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
    >
      {children}
    </select>
  );
}

function colOptions(columns: string[]) {
  return columns.map((c) => (
    <option key={c} value={c}>
      {c}
    </option>
  ));
}

/**
 * The Struttura step (left panel). Lets the operator review and OVERRIDE how
 * each column is used - geographic level + key, lat/lon, value, category, time,
 * label - and switch the dataset shape (area / point / table). Edits go through
 * the pure {@link applyMapping}; the right canvas ({@link StructurePreview})
 * shows the data table with a coloured role badge per column.
 */
export function StructurePanel() {
  const { data, setData, design, updateDesign } = useStudio();
  const { dict } = useI18n();
  const [mapping, setMapping] = useState<DatasetMapping | null>(
    data ? mappingFromDataset(data) : null,
  );
  const [error, setError] = useState<string | null>(null);

  // Reset the editable mapping only when a *different* dataset (file) loads -
  // re-mapping the same file keeps fileName+columns identical, so edits persist.
  const dataKey = data ? `${data.fileName}\u0000${data.columns.join(",")}` : "";
  useEffect(() => {
    setMapping(data ? mappingFromDataset(data) : null);
    setError(null);
  }, [dataKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !mapping) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
        {dict.structurePanel.chooseDataFirst}
      </p>
    );
  }

  const allColumns = data.columns;
  const numericColumns = detectNumericColumns(data.columns, data.rows);
  const kinds = kindsAvailable(data);

  // Commit an edited mapping: rebuild the dataset and store it, or surface the
  // reason it can't be built yet (e.g. a kind switch awaiting its bindings).
  const commit = (next: DatasetMapping) => {
    setMapping(next);
    const out = applyMapping(data, next);
    if ("error" in out) {
      setError(out.error);
    } else {
      setError(null);
      setData(out.dataset);
    }
  };
  const patch = (p: Partial<DatasetMapping>) => commit({ ...mapping, ...p });

  // Numeric value candidates, excluding columns already used as key/coords/time.
  const valueOptions = numericColumns.filter(
    (c) =>
      c !== mapping.keyColumn &&
      c !== mapping.timeColumn &&
      c !== mapping.latColumn &&
      c !== mapping.lonColumn,
  );

  // Second numeric value (variable B of a bivariate map): same exclusions plus
  // the first value column actually in use (explicit mapping or the resolved
  // "first numeric" default), so A and B can never be the same column.
  const firstValue =
    mapping.valueColumn ?? (data.kind === "area" ? data.valueColumn : null);
  const secondValueOptions = valueOptions.filter((c) => c !== firstValue);

  const isGeo = mapping.kind === "geo";

  return (
    <div className="space-y-6">
      <PanelSection
        title={dict.structurePanel.title}
        hint={dict.structurePanel.hint}
      >
        {isGeo ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {dict.structurePanel.geoNotePre}
            <strong>{dict.structurePanel.geoNoteBold}</strong>
            {dict.structurePanel.geoNotePost}
          </p>
        ) : (
          <Field label={dict.structurePanel.dataTypeLabel}>
            <div className="grid grid-cols-3 gap-2">
              {(["area", "point", "table"] as DatasetKind[])
                .filter((k) => kinds.has(k))
                .map((k) => {
                  const Icon = KIND_ICON[k];
                  const active = mapping.kind === k;
                  return (
                    <button
                      key={k}
                      onClick={() => patch({ kind: k })}
                      className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center transition-colors ${
                        active
                          ? "border-zornade bg-zornade-50 text-zornade-700"
                          : "border-slate-200 text-slate-600 hover:border-slate-300"
                      }`}
                    >
                      <Icon size={16} />
                      <span className="text-[11px] font-medium leading-tight">
                        {dict.datasetKind[k]}
                      </span>
                    </button>
                  );
                })}
            </div>
          </Field>
        )}

        {error && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            {error}
          </p>
        )}
      </PanelSection>

      {/* ---- Mappa per aree ---- */}
      {mapping.kind === "area" && (
        <PanelSection title={dict.structurePanel.areaMapTitle} hint={dict.structurePanel.areaMapHint}>
          <Field label={dict.structurePanel.geoLevelLabel}>
            <Select
              value={mapping.geoLevel ?? ""}
              onChange={(v) => patch({ geoLevel: (v || null) as GeoLevel | null })}
            >
              <option value="">{dict.structurePanel.chooseOption}</option>
              {Object.values(GEO_LEVELS).map((l) => (
                <option key={l.id} value={l.id}>
                  {dict.geoLevels[l.id] ?? l.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={dict.structurePanel.keyColumnLabel} hint={dict.structurePanel.keyColumnHint}>
            <Select
              value={mapping.keyColumn ?? ""}
              onChange={(v) => patch({ keyColumn: v || null })}
            >
              <option value="">{dict.structurePanel.chooseOption}</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
          <Field label={dict.structurePanel.valueColumnLabel}>
            <Select
              value={mapping.valueColumn ?? ""}
              onChange={(v) => patch({ valueColumn: v || null })}
            >
              <option value="">{dict.structurePanel.firstNumericOption}</option>
              {colOptions(valueOptions)}
            </Select>
          </Field>
          <Field
            label={dict.structurePanel.secondValueLabel}
            hint={dict.structurePanel.secondValueHint}
          >
            <Select
              value={design.bivariateColumn2}
              onChange={(v) => updateDesign({ bivariateColumn2: v })}
            >
              <option value="">{dict.structurePanel.autoNextNumericOption}</option>
              {colOptions(secondValueOptions)}
            </Select>
          </Field>
          <Field label={dict.structurePanel.categoryLabelOpt} hint={dict.structurePanel.categoryHintForArea}>
            <Select
              value={mapping.categoryColumn ?? ""}
              onChange={(v) => patch({ categoryColumn: v || null })}
            >
              <option value="">{dict.structurePanel.noneOption}</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
          <Field label={dict.structurePanel.timeLabelOpt} hint={dict.structurePanel.timeHint}>
            <Select
              value={mapping.timeColumn ?? ""}
              onChange={(v) => patch({ timeColumn: v || null })}
            >
              <option value="">{dict.structurePanel.noneOption}</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
        </PanelSection>
      )}

      {/* ---- Mappa per punti ---- */}
      {mapping.kind === "point" && (
        <PanelSection title={dict.structurePanel.pointMapTitle} hint={dict.structurePanel.pointMapHint}>
          <Field label={dict.structurePanel.latLabel}>
            <Select
              value={mapping.latColumn ?? ""}
              onChange={(v) => patch({ latColumn: v || null })}
            >
              <option value="">{dict.structurePanel.chooseOption}</option>
              {colOptions(numericColumns)}
            </Select>
          </Field>
          <Field label={dict.structurePanel.lonLabel}>
            <Select
              value={mapping.lonColumn ?? ""}
              onChange={(v) => patch({ lonColumn: v || null })}
            >
              <option value="">{dict.structurePanel.chooseOption}</option>
              {colOptions(numericColumns)}
            </Select>
          </Field>
          <Field label={dict.structurePanel.sizeLabelOpt} hint={dict.structurePanel.sizeHint}>
            <Select
              value={mapping.valueColumn ?? ""}
              onChange={(v) => patch({ valueColumn: v || null })}
            >
              <option value="">{dict.structurePanel.uniformOption}</option>
              {colOptions(valueOptions)}
            </Select>
          </Field>
          <Field label={dict.structurePanel.categoryLabelOpt}>
            <Select
              value={mapping.categoryColumn ?? ""}
              onChange={(v) => patch({ categoryColumn: v || null })}
            >
              <option value="">{dict.structurePanel.noneOption}</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
          <Field label={dict.structurePanel.labelOpt} hint={dict.structurePanel.labelHintTooltip}>
            <Select
              value={mapping.nameColumn ?? ""}
              onChange={(v) => patch({ nameColumn: v || null })}
            >
              <option value="">{dict.structurePanel.noneOption}</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
        </PanelSection>
      )}

      {/* ---- Geometria propria ---- */}
      {mapping.kind === "geo" && (
        <PanelSection title={dict.structurePanel.ownGeometryTitle} hint={dict.structurePanel.ownGeometryHint}>
          <Field label={dict.structurePanel.valueColumnOptLabel}>
            <Select
              value={mapping.valueColumn ?? ""}
              onChange={(v) => patch({ valueColumn: v || null })}
            >
              <option value="">{dict.structurePanel.noneOption}</option>
              {colOptions(numericColumns)}
            </Select>
          </Field>
          <Field label={dict.structurePanel.categoryLabelOpt}>
            <Select
              value={mapping.categoryColumn ?? ""}
              onChange={(v) => patch({ categoryColumn: v || null })}
            >
              <option value="">{dict.structurePanel.noneOption}</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
          <Field label={dict.structurePanel.labelOpt}>
            <Select
              value={mapping.nameColumn ?? ""}
              onChange={(v) => patch({ nameColumn: v || null })}
            >
              <option value="">{dict.structurePanel.noneOption}</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
        </PanelSection>
      )}

      {/* ---- Tabella / grafico (assi) ---- */}
      {mapping.kind === "table" && (
        <PanelSection title={dict.structurePanel.chartAxesTitle} hint={dict.structurePanel.chartAxesHint}>
          <Field label={dict.structurePanel.xAxisLabel}>
            <Select value={design.chartX} onChange={(v) => updateDesign({ chartX: v })}>
              <option value="">{dict.structurePanel.autoOption}</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
          <Field label={dict.structurePanel.yAxisLabel}>
            <Select value={design.chartY} onChange={(v) => updateDesign({ chartY: v })}>
              <option value="">{dict.structurePanel.autoOption}</option>
              {colOptions(numericColumns)}
            </Select>
          </Field>
          <Field label={dict.structurePanel.seriesLabel}>
            <Select
              value={design.chartSeries}
              onChange={(v) => updateDesign({ chartSeries: v })}
            >
              <option value="">{dict.structurePanel.noneOption}</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
        </PanelSection>
      )}
    </div>
  );
}

/**
 * The Struttura step (right canvas): the data table with a coloured role badge
 * per column header, reflecting the committed mapping. Gives the operator an
 * at-a-glance view of how every column is being used.
 */
export function StructurePreview() {
  const { data, design } = useStudio();
  const { dict } = useI18n();
  if (!data) return null;
  const numericSet = new Set(detectNumericColumns(data.columns, data.rows));
  const m = mappingFromDataset(data);
  const roles: Record<string, BadgeRole> = {};
  for (const c of data.columns) roles[c] = roleOf(c, m, numericSet);
  if (data.kind === "table") {
    if (design.chartX) roles[design.chartX] = "x";
    if (design.chartY) roles[design.chartY] = "y";
    if (design.chartSeries) roles[design.chartSeries] = "series";
  }
  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div className="flex-shrink-0 border-b border-slate-200 px-6 py-3">
        <h2 className="text-sm font-semibold text-slate-800">
          {dict.structurePanel.previewTitle(data.fileName)}
        </h2>
        <p className="text-xs text-slate-500">
          {dict.structurePanel.previewSummary(data.rows.length, data.columns.length)}
        </p>
      </div>
      <div className="min-h-0 flex-1 p-6">
        <DataTableView columns={data.columns} rows={data.rows} roles={roles} />
      </div>
    </div>
  );
}
