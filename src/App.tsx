import { ChevronLeft, ChevronRight } from "lucide-react";
import { StudioProvider, useStudio } from "./studio/StudioContext";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { LoginScreen } from "./components/LoginScreen";
import { Topbar } from "./components/Topbar";
import { Stepper } from "./components/Stepper";
import { MapCanvas } from "./components/MapCanvas";
import { MapErrorBoundary } from "./components/MapErrorBoundary";
import { DataPanel } from "./components/panels/DataPanel";
import { VisualizePanel } from "./components/panels/VisualizePanel";
import { DesignPanel } from "./components/panels/DesignPanel";
import { PublishPanel } from "./components/panels/PublishPanel";
import { Button } from "./components/primitives";
import type { StepId } from "./studio/types";

const STEP_ORDER: StepId[] = ["data", "visualize", "design", "publish"];

function Workspace() {
  const { step, setStep } = useStudio();
  const idx = STEP_ORDER.indexOf(step);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[368px] flex-shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="scrollbar-thin flex-1 overflow-y-auto p-5">
          {step === "data" && <DataPanel />}
          {step === "visualize" && <VisualizePanel />}
          {step === "design" && <DesignPanel />}
          {step === "publish" && <PublishPanel />}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 p-3">
          <Button
            variant="ghost"
            disabled={idx === 0}
            onClick={() => setStep(STEP_ORDER[idx - 1])}
          >
            <ChevronLeft size={16} />
            Indietro
          </Button>
          <Button
            variant="primary"
            disabled={idx === STEP_ORDER.length - 1}
            onClick={() => setStep(STEP_ORDER[idx + 1])}
          >
            Avanti
            <ChevronRight size={16} />
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <MapErrorBoundary>
          <MapCanvas />
        </MapErrorBoundary>
      </main>
    </div>
  );
}

function StudioShell() {
  const { isAuthed } = useAuth();
  if (!isAuthed) return <LoginScreen />;
  return (
    <StudioProvider>
      <div className="flex h-full flex-col bg-slate-50">
        <Topbar />
        <Stepper />
        <Workspace />
      </div>
    </StudioProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <StudioShell />
    </AuthProvider>
  );
}
