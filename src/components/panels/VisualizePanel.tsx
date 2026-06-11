import { useMemo } from "react";
import { useStudio } from "../../studio/StudioContext";
import { VIZ_GROUPS } from "../../studio/catalog";
import { PanelSection, SoonBadge } from "../primitives";

export function VisualizePanel() {
  const { vizType, setVizType, data } = useStudio();

  // Which visualisations actually work with the loaded data. The current
  // pipeline joins tabular data onto administrative polygons, so the choropleth
  // is the working option; point-based maps need coordinate columns we don't
  // ingest yet. Without data, nothing is selectable.
  const compatible = useMemo<Set<string>>(() => {
    if (!data) return new Set();
    return new Set(["choropleth"]);
  }, [data]);

  return (
    <div className="space-y-6">
      {!data && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Scegli prima i dati di partenza nel passo “Dati”.
        </p>
      )}
      {data && (
        <p className="text-xs text-slate-500">
          Sono attive solo le visualizzazioni compatibili con i dati caricati.
        </p>
      )}

      {VIZ_GROUPS.map((group) => (
        <PanelSection key={group.id} title={group.label}>
          <div className="grid grid-cols-2 gap-2">
            {group.items.map((item) => {
              const Icon = item.icon;
              const soon = item.status === "soon";
              const enabled = item.status === "ready" && compatible.has(item.id);
              const disabled = !enabled;
              const active = vizType === item.id && enabled;
              return (
                <button
                  key={item.id}
                  disabled={disabled}
                  onClick={() => setVizType(item.id)}
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
                    {soon && <SoonBadge />}
                  </span>
                  <span className="text-sm font-medium text-slate-800">
                    {item.label}
                  </span>
                  <span className="text-xs text-slate-500">{item.desc}</span>
                </button>
              );
            })}
          </div>
        </PanelSection>
      ))}
    </div>
  );
}
