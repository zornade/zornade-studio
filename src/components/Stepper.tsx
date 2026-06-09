import { Database, BarChart3, Palette, Share2, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useStudio } from "../studio/StudioContext";
import type { StepId } from "../studio/types";

interface StepDef {
  id: StepId;
  label: string;
  icon: LucideIcon;
}

const STEPS: StepDef[] = [
  { id: "data", label: "Dati", icon: Database },
  { id: "visualize", label: "Visualizza", icon: BarChart3 },
  { id: "design", label: "Design", icon: Palette },
  { id: "publish", label: "Pubblica", icon: Share2 },
];

export function Stepper() {
  const { step, setStep } = useStudio();
  const activeIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <nav
      aria-label="Fasi di creazione"
      className="flex flex-shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-4 py-2"
    >
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const isActive = i === activeIndex;
        const isDone = i < activeIndex;
        return (
          <div key={s.id} className="flex items-center">
            <button
              onClick={() => setStep(s.id)}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-zornade-50 text-zornade-700"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              }`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold ${
                  isActive
                    ? "bg-zornade text-white"
                    : isDone
                      ? "bg-zornade-100 text-zornade-700"
                      : "bg-slate-200 text-slate-500"
                }`}
              >
                {isDone ? <Check size={12} /> : i + 1}
              </span>
              <Icon size={15} />
              {s.label}
            </button>
            {i < STEPS.length - 1 && (
              <div className="mx-1 h-px w-5 bg-slate-200" />
            )}
          </div>
        );
      })}
    </nav>
  );
}
