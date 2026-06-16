import { useMemo } from "react";
import { useStudio } from "../../studio/StudioContext";
import { VIZ_GROUPS } from "../../studio/catalog";
import { PanelSection, SoonBadge } from "../primitives";
import { profileColumns, type SemanticType } from "../../lib/profile";
import { evaluateCompatibility } from "../../lib/viz-compat";
import { GEO_LEVELS, type GeoResolution } from "../../lib/choropleth";

/** Viz types whose rendering is actually implemented today. */
const IMPLEMENTED = new Set<string>(["choropleth", "points"]);

/** Italian label for each semantic column type (for the summary). */
const TYPE_LABEL: Record<SemanticType, string> = {
  "geo-point-lat": "latitudine",
  "geo-point-lon": "longitudine",
  temporal: "temporale",
  quantitative: "numerico",
  categorical: "categoria",
  identifier: "identificatore",
  text: "testo",
  empty: "vuoto",
};

export function VisualizePanel() {
  const { vizType, setVizType, data } = useStudio();

  // Profile the loaded data and evaluate which visualisations it supports.
  // Geo level/key are already resolved at load time (value-based), so we feed a
  // GeoResolution to the compatibility engine.
  const { compat, summary } = useMemo(() => {
    if (!data) return { compat: null, summary: null };
    const profile = profileColumns(data.columns, data.rows);
    // Area datasets carry a resolved geo level/key; point datasets don't.
    const geo: GeoResolution | null =
      data.kind === "area"
        ? { level: data.geoLevel, keyColumn: data.keyColumn, score: 1, alternatives: [] }
        : null;
    return {
      compat: evaluateCompatibility(profile, geo),
      summary: { profile, geo },
    };
  }, [data]);

  return (
    <div className="space-y-6">
      {!data && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Scegli prima i dati di partenza nel passo “Dati”.
        </p>
      )}

      {data && summary && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Cosa abbiamo capito
          </p>
          <p className="text-xs text-slate-600">
            {summary.geo ? (
              <>
                Livello geografico:{" "}
                <span className="font-medium text-slate-800">
                  {GEO_LEVELS[summary.geo.level].label}
                </span>{" "}
                · chiave “{summary.geo.keyColumn}”
              </>
            ) : (
              <>
                Tipo di dato:{" "}
                <span className="font-medium text-slate-800">punti (coordinate)</span>
              </>
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {summary.profile.columns.map((c) => (
              <span
                key={c.name}
                className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200"
                title={`${c.name}: ${TYPE_LABEL[c.type]} (${Math.round(c.confidence * 100)}%)`}
              >
                {c.name} · {TYPE_LABEL[c.type]}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Le visualizzazioni si attivano in base ai dati. Puoi correggere il
            livello e la colonna chiave nel passo “Design”.
          </p>
        </div>
      )}

      {VIZ_GROUPS.map((group) => (
        <PanelSection key={group.id} title={group.label}>
          <div className="grid grid-cols-2 gap-2">
            {group.items.map((item) => {
              const Icon = item.icon;
              const c = compat?.[item.id];
              const dataCompatible = c?.compatible ?? false;
              const implemented = IMPLEMENTED.has(item.id);
              const enabled = !!data && dataCompatible && implemented;
              const disabled = !enabled;
              const active = vizType === item.id && enabled;
              // Badge: "presto" if data fits but not yet built; otherwise the
              // incompatibility reason is surfaced via title.
              const showSoon = data ? dataCompatible && !implemented : item.status === "soon";
              const reason =
                data && !dataCompatible ? c?.reason : undefined;
              return (
                <button
                  key={item.id}
                  disabled={disabled}
                  onClick={() => setVizType(item.id)}
                  title={reason}
                  className={`flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-all ${
                    active
                      ? "border-zornade bg-zornade-50 ring-1 ring-zornade"
                      : disabled
                        ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-60"
                        : "border-slate-200 bg-white hover:border-zornade hover:shadow-sm"
                  }`}
                >
                  <span className="flex items-center justify-between">
                    <Icon
                      size={18}
                      className={active ? "text-zornade-700" : "text-slate-500"}
                    />
                    {showSoon && <SoonBadge />}
                  </span>
                  <span className="text-sm font-medium text-slate-800">
                    {item.label}
                  </span>
                  <span className="text-xs text-slate-500">
                    {reason ?? item.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </PanelSection>
      ))}
    </div>
  );
}
