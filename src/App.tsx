import { ChevronLeft, ChevronRight, MapPinned } from "lucide-react";
import { StudioProvider, useStudio } from "./studio/StudioContext";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { SupabaseAuthProvider, useSupabaseAuth } from "./auth/SupabaseAuthContext";
import { combineAuthState } from "./auth/combine-auth";
import { LoginScreen } from "./components/LoginScreen";
import { Topbar } from "./components/Topbar";
import { Stepper } from "./components/Stepper";
import { MapCanvas } from "./components/MapCanvas";
import { ChartCanvas } from "./components/ChartCanvas";
import { MapErrorBoundary } from "./components/MapErrorBoundary";
import { DataPanel } from "./components/panels/DataPanel";
import { StructurePanel, StructurePreview } from "./components/panels/StructurePanel";
import { VisualizePanel } from "./components/panels/VisualizePanel";
import { DesignPanel } from "./components/panels/DesignPanel";
import { PublishPanel } from "./components/panels/PublishPanel";
import { BboxPickerMap } from "./components/BboxPickerMap";
import { Button } from "./components/primitives";
import { isChartType } from "./lib/chart-data";
import type { StepId } from "./studio/types";

const STEP_ORDER: StepId[] = ["data", "structure", "visualize", "design", "publish"];

function MapEmptyState() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-50 p-8">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-zornade-50 text-zornade-700">
          <MapPinned size={26} />
        </div>
        <h2 className="font-display text-lg font-semibold text-slate-800">
          Scegli i dati di partenza
        </h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Nel pannello a sinistra scegli se usare una fonte di dati pronta dal
          catalogo oppure caricare i tuoi dati. La mappa apparirà qui appena i
          dati saranno caricati.
        </p>
      </div>
    </div>
  );
}

function Workspace() {
  const { step, setStep, data, vizType, bboxPickMode, pendingBbox, setPendingBbox } = useStudio();
  const idx = STEP_ORDER.indexOf(step);

  // Charts and the rich table render on a separate canvas (Observable Plot /
  // HTML), not MapLibre. A non-geographic "table" dataset always uses it.
  const useChartCanvas =
    isChartType(vizType) || vizType === "table" || data?.kind === "table";

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[368px] flex-shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="scrollbar-thin flex-1 overflow-y-auto p-5">
          {step === "data" && <DataPanel />}
          {step === "structure" && <StructurePanel />}
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
        {bboxPickMode ? (
          /* Bbox picker: replaces any existing canvas while OSM bbox mode is active */
          <BboxPickerMap
            value={pendingBbox}
            onChange={setPendingBbox}
            fullscreen
          />
        ) : data ? (
          step === "structure" ? (
            <StructurePreview />
          ) : (
            <MapErrorBoundary>
              {useChartCanvas ? <ChartCanvas /> : <MapCanvas />}
            </MapErrorBoundary>
          )
        ) : (
          <MapEmptyState />
        )}
      </main>
    </div>
  );
}

function StudioShell() {
  const legacy = useAuth();
  const supabaseAuth = useSupabaseAuth();
  const legacyConfigured = legacy.legacyEnabled && !legacy.notConfigured;
  const { isAuthed, loading } = combineAuthState(
    { ...legacy, configured: legacyConfigured },
    { ...supabaseAuth, configured: supabaseAuth.isConfigured },
  );
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50">
        <img
          src="/zornade-icon.svg"
          alt="Zornade"
          className="h-10 w-10 animate-pulse opacity-70"
        />
      </div>
    );
  }
  // Full-page gate ONLY when the legacy shared-password gate is actually
  // enabled for this deployment (VITE_STUDIO_LEGACY_LOGIN_ENABLED=true, a
  // private-beta-style restriction where the whole point is to keep the
  // tool closed to anyone who hasn't cleared it). In every other case - the
  // official zornade.com/studio default (Supabase-only) or a bare self-host
  // with nothing configured - the editor is open to everyone from the
  // first load; login is only prompted contextually, at the moment an
  // action that genuinely needs an identity is attempted (save to cloud,
  // share, publish) - see AuthGateModal, used by Topbar and PublishPanel.
  if (legacyConfigured && !isAuthed) return <LoginScreen />;
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
      <SupabaseAuthProvider>
        <StudioShell />
      </SupabaseAuthProvider>
    </AuthProvider>
  );
}
