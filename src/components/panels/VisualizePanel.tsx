import { useStudio } from "../../studio/StudioContext";
import { VIZ_GROUPS } from "../../studio/catalog";
import { PanelSection, SoonBadge } from "../primitives";

export function VisualizePanel() {
  const { vizType, setVizType } = useStudio();

  return (
    <div className="space-y-6">
      {VIZ_GROUPS.map((group) => (
        <PanelSection key={group.id} title={group.label}>
          <div className="grid grid-cols-2 gap-2">
            {group.items.map((item) => {
              const Icon = item.icon;
              const disabled = item.status === "soon";
              const active = vizType === item.id;
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
                    {disabled && <SoonBadge />}
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
