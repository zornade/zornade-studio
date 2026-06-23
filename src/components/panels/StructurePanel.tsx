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
  kindLabel,
  type DatasetMapping,
  type DatasetKind,
} from "../../lib/mapping";
import { detectNumericColumns } from "../../lib/csv";
import { GEO_LEVELS, type GeoLevel } from "../../lib/choropleth";

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
 * each column is used — geographic level + key, lat/lon, value, category, time,
 * label — and switch the dataset shape (area / point / table). Edits go through
 * the pure {@link applyMapping}; the right canvas ({@link StructurePreview})
 * shows the data table with a coloured role badge per column.
 */
export function StructurePanel() {
  const { data, setData, design, updateDesign } = useStudio();
  const [mapping, setMapping] = useState<DatasetMapping | null>(
    data ? mappingFromDataset(data) : null,
  );
  const [error, setError] = useState<string | null>(null);

  // Reset the editable mapping only when a *different* dataset (file) loads —
  // re-mapping the same file keeps fileName+columns identical, so edits persist.
  const dataKey = data ? `${data.fileName}\u0000${data.columns.join(",")}` : "";
  useEffect(() => {
    setMapping(data ? mappingFromDataset(data) : null);
    setError(null);
  }, [dataKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !mapping) {
    return (
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
        Scegli prima i dati nel passo “Dati”.
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

  const isGeo = mapping.kind === "geo";

  return (
    <div className="space-y-6">
      <PanelSection
        title="Struttura dei dati"
        hint="Conferma o correggi come usare ogni colonna. L'anteprima a destra mostra il ruolo di ciascuna."
      >
        {isGeo ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Questo file porta la sua <strong>geometria</strong>: viene disegnata
            direttamente. Sotto scegli cosa colorare ed etichettare.
          </p>
        ) : (
          <Field label="Tipo di dato">
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
                        {kindLabel(k)}
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
        <PanelSection title="Mappa per aree" hint="Unisci i dati alla geografia.">
          <Field label="Livello geografico">
            <Select
              value={mapping.geoLevel ?? ""}
              onChange={(v) => patch({ geoLevel: (v || null) as GeoLevel | null })}
            >
              <option value="">— scegli —</option>
              {Object.values(GEO_LEVELS).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Colonna chiave" hint="La colonna che identifica l'area (nome o codice).">
            <Select
              value={mapping.keyColumn ?? ""}
              onChange={(v) => patch({ keyColumn: v || null })}
            >
              <option value="">— scegli —</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
          <Field label="Colonna valore">
            <Select
              value={mapping.valueColumn ?? ""}
              onChange={(v) => patch({ valueColumn: v || null })}
            >
              <option value="">— prima numerica —</option>
              {colOptions(valueOptions)}
            </Select>
          </Field>
          <Field label="Categoria (opzionale)" hint="Per la mappa a categorie.">
            <Select
              value={mapping.categoryColumn ?? ""}
              onChange={(v) => patch({ categoryColumn: v || null })}
            >
              <option value="">— nessuna —</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
          <Field label="Tempo (opzionale)" hint="Una colonna periodo abilita la linea del tempo.">
            <Select
              value={mapping.timeColumn ?? ""}
              onChange={(v) => patch({ timeColumn: v || null })}
            >
              <option value="">— nessuna —</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
        </PanelSection>
      )}

      {/* ---- Mappa per punti ---- */}
      {mapping.kind === "point" && (
        <PanelSection title="Mappa per punti" hint="Posiziona i punti dalle coordinate.">
          <Field label="Latitudine">
            <Select
              value={mapping.latColumn ?? ""}
              onChange={(v) => patch({ latColumn: v || null })}
            >
              <option value="">— scegli —</option>
              {colOptions(numericColumns)}
            </Select>
          </Field>
          <Field label="Longitudine">
            <Select
              value={mapping.lonColumn ?? ""}
              onChange={(v) => patch({ lonColumn: v || null })}
            >
              <option value="">— scegli —</option>
              {colOptions(numericColumns)}
            </Select>
          </Field>
          <Field label="Dimensione (opzionale)" hint="Un valore numerico dimensiona i punti.">
            <Select
              value={mapping.valueColumn ?? ""}
              onChange={(v) => patch({ valueColumn: v || null })}
            >
              <option value="">— uniforme —</option>
              {colOptions(valueOptions)}
            </Select>
          </Field>
          <Field label="Categoria (opzionale)">
            <Select
              value={mapping.categoryColumn ?? ""}
              onChange={(v) => patch({ categoryColumn: v || null })}
            >
              <option value="">— nessuna —</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
          <Field label="Etichetta (opzionale)" hint="Mostrata nei tooltip e nel localizzatore.">
            <Select
              value={mapping.nameColumn ?? ""}
              onChange={(v) => patch({ nameColumn: v || null })}
            >
              <option value="">— nessuna —</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
        </PanelSection>
      )}

      {/* ---- Geometria propria ---- */}
      {mapping.kind === "geo" && (
        <PanelSection title="Geometria propria" hint="Scegli cosa colorare ed etichettare.">
          <Field label="Colonna valore (opzionale)">
            <Select
              value={mapping.valueColumn ?? ""}
              onChange={(v) => patch({ valueColumn: v || null })}
            >
              <option value="">— nessuna —</option>
              {colOptions(numericColumns)}
            </Select>
          </Field>
          <Field label="Categoria (opzionale)">
            <Select
              value={mapping.categoryColumn ?? ""}
              onChange={(v) => patch({ categoryColumn: v || null })}
            >
              <option value="">— nessuna —</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
          <Field label="Etichetta (opzionale)">
            <Select
              value={mapping.nameColumn ?? ""}
              onChange={(v) => patch({ nameColumn: v || null })}
            >
              <option value="">— nessuna —</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
        </PanelSection>
      )}

      {/* ---- Tabella / grafico (assi) ---- */}
      {mapping.kind === "table" && (
        <PanelSection title="Assi del grafico" hint="Per i grafici dai dati senza geografia.">
          <Field label="Asse X (categoria / tempo)">
            <Select value={design.chartX} onChange={(v) => updateDesign({ chartX: v })}>
              <option value="">— automatico —</option>
              {colOptions(allColumns)}
            </Select>
          </Field>
          <Field label="Asse Y (valore)">
            <Select value={design.chartY} onChange={(v) => updateDesign({ chartY: v })}>
              <option value="">— automatico —</option>
              {colOptions(numericColumns)}
            </Select>
          </Field>
          <Field label="Serie / colore (opzionale)">
            <Select
              value={design.chartSeries}
              onChange={(v) => updateDesign({ chartSeries: v })}
            >
              <option value="">— nessuna —</option>
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
          Anteprima dati · {data.fileName}
        </h2>
        <p className="text-xs text-slate-500">
          {data.rows.length} righe · {data.columns.length} colonne. I colori
          mostrano il ruolo di ogni colonna.
        </p>
      </div>
      <div className="min-h-0 flex-1 p-6">
        <DataTableView columns={data.columns} rows={data.rows} roles={roles} />
      </div>
    </div>
  );
}
