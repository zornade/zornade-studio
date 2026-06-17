import {
  createContext,
  useContext,
  useEffect,
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
import type { SavableProject } from "../lib/project";

interface StudioContextValue extends StudioState {
  setStep: (step: StepId) => void;
  updateProject: (patch: Partial<ProjectMeta>) => void;
  setDataSource: (source: DataSourceKind) => void;
  setVizType: (id: string) => void;
  applyPreset: (name: PresetChoice) => void;
  updateBrand: (patch: Partial<NewsroomBrand>) => void;
  updateDesign: (patch: Partial<DesignSettings>) => void;
  setData: (data: DatasetState | null) => void;
  /** Replace the whole editor state (open a saved project). */
  loadProject: (state: SavableProject) => void;
  /** Ref to the map container node, for PNG export (set by MapCanvas). */
  exportNodeRef: MutableRefObject<HTMLElement | null>;
}

const StudioContext = createContext<StudioContextValue | null>(null);

const INITIAL_BRAND: NewsroomBrand = { ...PRESETS.zornade };

const INITIAL_DESIGN: DesignSettings = {
  titleFont: '"Space Grotesk", sans-serif',
  basemap: "ofm-positron",
  colorScale: "teal-seq",
  reverseScale: false,
  classification: "quantile",
  manualBreaks: [],
  legendType: "steps",
  nClasses: 5,
  valueLabel: "",
  valueUnit: "",
  pointColor: "#01646f",
  pointSize: 7,
  showTitle: true,
  showLegend: true,
  showSource: true,
  tooltip: true,
  tooltipTemplate: "",
  zoomPan: true,
  readerFilters: false,
};

/** localStorage key for the best-effort session autosave. */
const AUTOSAVE_KEY = "zornade-studio:autosave";

/** Read the autosaved session, or null if absent/corrupt. */
function readAutosave(): StudioState | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StudioState>;
    // Minimal shape guard; on mismatch we ignore and start fresh.
    if (!v || typeof v !== "object" || !v.project || !v.design) return null;
    return v as StudioState;
  } catch {
    return null;
  }
}

/** Write the session autosave, swallowing quota/serialisation errors. */
function writeAutosave(state: StudioState): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded (large dataset) or storage unavailable → skip silently.
  }
}

export function StudioProvider({ children }: { children: ReactNode }) {
  // Restore the last session from localStorage (best-effort autosave) so an
  // accidental refresh doesn't lose work. Read once before the first render.
  const restored = readAutosave();

  const [step, setStep] = useState<StepId>(restored?.step ?? "data");
  const [project, setProject] = useState<ProjectMeta>(
    restored?.project ?? {
      title: "Mappa senza titolo",
      subtitle: "",
      source: "Fatto con Zornade Studio",
    },
  );
  const [dataSource, setDataSource] = useState<DataSourceKind>(
    restored?.dataSource ?? null,
  );
  const [vizType, setVizType] = useState<string>(restored?.vizType ?? "choropleth");
  const [preset, setPreset] = useState<PresetChoice>(restored?.preset ?? "zornade");
  const [brand, setBrand] = useState<NewsroomBrand>(restored?.brand ?? INITIAL_BRAND);
  const [design, setDesign] = useState<DesignSettings>(
    restored?.design ?? INITIAL_DESIGN,
  );
  const [data, setData] = useState<DatasetState | null>(restored?.data ?? null);
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
      loadProject: (s) => {
        setStep(s.step ?? "design");
        setProject(s.project);
        setDataSource(s.dataSource ?? null);
        setVizType(s.vizType);
        setPreset(s.preset);
        setBrand(s.brand);
        setDesign(s.design);
        setData(s.data);
      },
      exportNodeRef,
    }),
    [step, project, dataSource, vizType, preset, brand, design, data],
  );

  // Best-effort autosave of the current session to localStorage. Wrapped so a
  // quota error (e.g. a very large dataset) degrades gracefully instead of
  // throwing — the explicit "Salva progetto" file is the reliable path.
  useEffect(() => {
    writeAutosave({ step, project, dataSource, vizType, preset, brand, design, data });
  }, [step, project, dataSource, vizType, preset, brand, design, data]);

  return (
    <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
  );
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useStudio must be used within StudioProvider");
  return ctx;
}
