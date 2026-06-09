import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { PRESETS, type NewsroomBrand } from "../basemap";
import type {
  DataSourceKind,
  DesignSettings,
  ProjectMeta,
  StepId,
  StudioState,
} from "./types";
import type { PresetChoice } from "./catalog";

interface StudioContextValue extends StudioState {
  setStep: (step: StepId) => void;
  updateProject: (patch: Partial<ProjectMeta>) => void;
  setDataSource: (source: DataSourceKind) => void;
  setVizType: (id: string) => void;
  applyPreset: (name: PresetChoice) => void;
  updateBrand: (patch: Partial<NewsroomBrand>) => void;
  updateDesign: (patch: Partial<DesignSettings>) => void;
}

const StudioContext = createContext<StudioContextValue | null>(null);

const INITIAL_BRAND: NewsroomBrand = { ...PRESETS.zornade };

const INITIAL_DESIGN: DesignSettings = {
  titleFont: '"Space Grotesk", sans-serif',
  colorScale: "teal-seq",
  classification: "quantile",
  legendType: "steps",
  showTitle: true,
  showLegend: true,
  showSource: true,
};

export function StudioProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<StepId>("data");
  const [project, setProject] = useState<ProjectMeta>({
    title: "Mappa senza titolo",
    subtitle: "",
    source: "Dati e mappa: Zornade",
  });
  const [dataSource, setDataSource] = useState<DataSourceKind>(null);
  const [vizType, setVizType] = useState<string>("choropleth");
  const [preset, setPreset] = useState<PresetChoice>("zornade");
  const [brand, setBrand] = useState<NewsroomBrand>(INITIAL_BRAND);
  const [design, setDesign] = useState<DesignSettings>(INITIAL_DESIGN);

  const value = useMemo<StudioContextValue>(
    () => ({
      step,
      project,
      dataSource,
      vizType,
      preset,
      brand,
      design,
      setStep,
      updateProject: (patch) => setProject((p) => ({ ...p, ...patch })),
      setDataSource,
      setVizType,
      applyPreset: (name) => {
        setPreset(name);
        if (name !== "custom" && PRESETS[name]) {
          setBrand({ ...PRESETS[name] });
        }
      },
      updateBrand: (patch) => {
        setPreset("custom");
        setBrand((b) => ({ ...b, ...patch }));
      },
      updateDesign: (patch) => setDesign((d) => ({ ...d, ...patch })),
    }),
    [step, project, dataSource, vizType, preset, brand, design],
  );

  return (
    <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
  );
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used within StudioProvider");
  return ctx;
}
