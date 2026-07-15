import { Database, Columns3, BarChart3, Palette, Share2, Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useStudio } from "../studio/StudioContext";
import type { StepId } from "../studio/types";
import { useI18n } from "../i18n/LanguageContext";

interface StepDef {
  id: StepId;
  icon: LucideIcon;
}

const STEP_META: StepDef[] = [
  { id: "data", icon: Database },
  { id: "structure", icon: Columns3 },
  { id: "visualize", icon: BarChart3 },
  { id: "design", icon: Palette },
  { id: "publish", icon: Share2 },
];

export function Stepper() {
  const { step, setStep } = useStudio();
  const { dict } = useI18n();
  const STEPS = STEP_META.map((s) => ({ ...s, label: dict.stepper[s.id] }));
  const activeIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <nav
      aria-label={dict.stepper.ariaLabel}
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
