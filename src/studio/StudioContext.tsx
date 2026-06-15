import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { PRESETS, type NewsroomBrand } from "../basemap";
import type {
  DataSourceKind,
  DatasetState,
  DesignSettings,
  ProjectMeta,
  StepId,
  StudioState,
} from "./types";
import type { PresetChoice } from "./catalog";
import { NEWSROOM_KITS } from "./catalog";

interface StudioContextValue extends StudioState {
  setStep: (step: StepId) => void;
  updateProject: (patch: Partial<ProjectMeta>) => void;
  setDataSource: (source: DataSourceKind) => void;
  setVizType: (id: string) => void;
  applyPreset: (name: PresetChoice) => void;
  updateBrand: (patch: Partial<NewsroomBrand>) => void;
  updateDesign: (patch: Partial<DesignSettings>) => void;
  setData: (data: DatasetState | null) => void;
  /** Ref to the map container node, for PNG export (set by MapCanvas). */
  exportNodeRef: MutableRefObject<HTMLElement | null>;
}

const StudioContext = createContext<StudioContextValue | null>(null);

const INITIAL_BRAND: NewsroomBrand = { ...PRESETS.zornade };

const INITIAL_DESIGN: DesignSettings = {
  titleFont: '"Space Grotesk", sans-serif',
  basemap: "ofm-positron",
  colorScale: "teal-seq",
  classification: "quantile",
  manualBreaks: [],
  legendType: "steps",
  nClasses: 5,
  valueLabel: "",
  valueUnit: "",
  showTitle: true,
  showLegend: true,
  showSource: true,
  tooltip: true,
  zoomPan: true,
};

export function StudioProvider({ children }: { children: ReactNode }) {
  const [step, setStep] = useState<StepId>("data");
  const [project, setProject] = useState<ProjectMeta>({
    title: "Mappa senza titolo",
    subtitle: "",
    source: "Fatto con Zornade Studio",
  });
  const [dataSource, setDataSource] = useState<DataSourceKind>(null);
  const [vizType, setVizType] = useState<string>("choropleth");
  const [preset, setPreset] = useState<PresetChoice>("zornade");
  const [brand, setBrand] = useState<NewsroomBrand>(INITIAL_BRAND);
  const [design, setDesign] = useState<DesignSettings>(INITIAL_DESIGN);
  const [data, setData] = useState<DatasetState | null>(null);
  const exportNodeRef = useRef<HTMLElement | null>(null);

  const value = useMemo<StudioContextValue>(
    () => ({
      step,
      project,
      dataSource,
      vizType,
      preset,
      brand,
      design,
      data,
      setStep,
      updateProject: (patch) => setProject((p) => ({ ...p, ...patch })),
      setDataSource,
      setVizType,
      applyPreset: (name) => {
        setPreset(name);
        if (name !== "custom" && PRESETS[name]) {
          setBrand({ ...PRESETS[name] });
          const kit = NEWSROOM_KITS[name];
          if (kit) {
            setDesign((d) => ({
              ...d,
              titleFont: kit.titleFont,
              colorScale: kit.colorScale,
            }));
          }
        }
      },
      updateBrand: (patch) => {
        setPreset("custom");
        setBrand((b) => ({ ...b, ...patch }));
      },
      updateDesign: (patch) => setDesign((d) => ({ ...d, ...patch })),
      setData,
      exportNodeRef,
    }),
    [step, project, dataSource, vizType, preset, brand, design, data],
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
