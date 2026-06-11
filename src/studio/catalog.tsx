import type { LucideIcon } from "lucide-react";
import {
  Map as MapIcon,
  MapPin,
  Circle,
  Shapes,
  Crosshair,
  Flame,
  Hexagon,
  Spline,
  Box,
  BarChart3,
  LineChart,
  AreaChart,
  ScatterChart,
  PieChart,
  Table2,
  Network,
  TreePine,
  Radar,
  Clapperboard,
  Upload,
  ClipboardPaste,
  Link2,
  Globe2,
  Database,
  Grid3x3,
  Layers,
  Workflow,
  Boxes,
  Vote,
  TrendingUp,
  CalendarDays,
  Type,
  GanttChart,
  Plug,
  MoveUpRight,
  Highlighter,
  PenTool,
  Image as ImageIcon,
  Minus,
} from "lucide-react";
import { PRESETS, type PresetName } from "../basemap";

export { PRESETS };

/** A named brand preset, or the user's own customisation. */
export type PresetChoice = PresetName | "custom";

export type FeatureStatus = "ready" | "soon";

export interface CatalogItem {
  id: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  status: FeatureStatus;
}

export interface CatalogGroup {
  id: string;
  label: string;
  items: CatalogItem[];
}

/** Visualisation catalog — covers the competitor feature set; "soon" = roadmap. */
export const VIZ_GROUPS: CatalogGroup[] = [
  {
    id: "maps",
    label: "Mappe",
    items: [
      { id: "choropleth", label: "Coropletica", desc: "Aree colorate per valore", icon: MapIcon, status: "ready" },
      { id: "points", label: "Punti", desc: "Un punto per luogo", icon: MapPin, status: "ready" },
      { id: "locator", label: "Localizzatore", desc: "Pin + contesto", icon: Crosshair, status: "ready" },
      { id: "symbol", label: "Simboli proporzionali", desc: "Bolle dimensionate", icon: Circle, status: "soon" },
      { id: "category", label: "Categorie", desc: "Colore per categoria", icon: Shapes, status: "soon" },
      { id: "bivariate", label: "Bivariata", desc: "Due variabili insieme", icon: Grid3x3, status: "soon" },
      { id: "heatmap", label: "Mappa di calore", desc: "Densità", icon: Flame, status: "soon" },
      { id: "hexbin", label: "Esagoni", desc: "Griglia esagonale", icon: Hexagon, status: "soon" },
      { id: "flow", label: "Flussi", desc: "Origine → destinazione", icon: Spline, status: "soon" },
      { id: "raster", label: "Raster / satellite", desc: "GeoTIFF, WMS, tile", icon: Layers, status: "soon" },
      { id: "extrusion", label: "Estrusione 3D", desc: "Altezza per valore", icon: Box, status: "soon" },
    ],
  },
  {
    id: "charts",
    label: "Grafici",
    items: [
      { id: "bar", label: "Barre", desc: "Confronti", icon: BarChart3, status: "soon" },
      { id: "line", label: "Linee", desc: "Andamenti", icon: LineChart, status: "soon" },
      { id: "area", label: "Aree", desc: "Volumi nel tempo", icon: AreaChart, status: "soon" },
      { id: "scatter", label: "Dispersione", desc: "Correlazioni", icon: ScatterChart, status: "soon" },
      { id: "pie", label: "Torta", desc: "Composizione", icon: PieChart, status: "soon" },
      { id: "table", label: "Tabella", desc: "Con sparkline", icon: Table2, status: "soon" },
      { id: "sankey", label: "Sankey", desc: "Flussi tra nodi", icon: Network, status: "soon" },
      { id: "chord", label: "Chord", desc: "Relazioni circolari", icon: Workflow, status: "soon" },
      { id: "treemap", label: "Treemap", desc: "Gerarchie", icon: TreePine, status: "soon" },
      { id: "circlepack", label: "Circle pack", desc: "Gerarchie a bolle", icon: Boxes, status: "soon" },
      { id: "slope", label: "Slope", desc: "Variazioni", icon: TrendingUp, status: "soon" },
      { id: "parliament", label: "Emiciclo", desc: "Seggi/quote", icon: Vote, status: "soon" },
      { id: "calendar", label: "Calendar heatmap", desc: "Per giorno", icon: CalendarDays, status: "soon" },
      { id: "gantt", label: "Gantt", desc: "Cronoprogramma", icon: GanttChart, status: "soon" },
      { id: "radar", label: "Radar", desc: "Profili multi-asse", icon: Radar, status: "soon" },
      { id: "wordcloud", label: "Word cloud", desc: "Frequenze testo", icon: Type, status: "soon" },
    ],
  },
  {
    id: "stories",
    label: "Storytelling",
    items: [
      { id: "scrolly", label: "Scrollytelling", desc: "Passi narrativi animati", icon: Clapperboard, status: "soon" },
    ],
  },
];

/** Data source catalog. */
export const DATA_SOURCES: CatalogItem[] = [
  { id: "upload", label: "Carica file", desc: "CSV, Excel, GeoJSON, Shapefile, KML, GeoTIFF", icon: Upload, status: "ready" },
  { id: "paste", label: "Incolla dati", desc: "Da un foglio di calcolo", icon: ClipboardPaste, status: "soon" },
  { id: "url", label: "URL live", desc: "Google Sheets / CSV remoto", icon: Link2, status: "soon" },
  { id: "api", label: "API / Open data", desc: "ISTAT, Socrata, CKAN, JSON", icon: Plug, status: "soon" },
  { id: "osm", label: "OpenStreetMap", desc: "Porti, telecamere, scuole…", icon: Globe2, status: "soon" },
  { id: "zornade-db", label: "Database Zornade", desc: "OMI, rischio, solare, demografia", icon: Database, status: "soon" },
];

/** Curated OSM (Overpass) point searches — "Cosa cerchi?". */
export interface OsmPreset {
  id: string;
  label: string;
  tag: string;
}
export const OSM_PRESETS: OsmPreset[] = [
  { id: "ports", label: "Porti", tag: "harbour=yes / leisure=marina" },
  { id: "surveillance", label: "Telecamere di sorveglianza", tag: "man_made=surveillance" },
  { id: "schools", label: "Scuole", tag: "amenity=school" },
  { id: "hospitals", label: "Ospedali", tag: "amenity=hospital" },
  { id: "pharmacies", label: "Farmacie", tag: "amenity=pharmacy" },
  { id: "charging", label: "Colonnine di ricarica", tag: "amenity=charging_station" },
  { id: "parking", label: "Parcheggi", tag: "amenity=parking" },
  { id: "fountains", label: "Fontane", tag: "amenity=fountain" },
  { id: "libraries", label: "Biblioteche", tag: "amenity=library" },
];

/** Guided datasets available from the Zornade DB (read-only). */
export interface ZornadeDataset {
  id: string;
  label: string;
  desc: string;
  level: "comune" | "provincia" | "cap" | "sezione";
}
export const ZORNADE_DATASETS: ZornadeDataset[] = [
  { id: "omi", label: "Prezzi immobiliari (OMI)", desc: "€/m² compravendita e affitto, 2015→oggi", level: "comune" },
  { id: "risk", label: "Rischio territoriale", desc: "Sismico, alluvione, frana, subsidenza", level: "comune" },
  { id: "solar", label: "Potenziale solare", desc: "Idoneità tetti, kWh/anno, payback", level: "comune" },
  { id: "demographics", label: "Indicatori socio-demografici", desc: "Età media, densità, occupazione, stranieri", level: "sezione" },
  { id: "addresses", label: "Indirizzi & CAP", desc: "9.228 zone CAP, indirizzi ANNCSU", level: "cap" },
  { id: "realestate", label: "Annunci immobiliari", desc: "Real estate per zona", level: "comune" },
];

/** Customisable fonts for the newsroom (UI/title font is applied live). */
export interface FontOption {
  id: string;
  label: string;
  stack: string;
}
export const FONT_OPTIONS: FontOption[] = [
  { id: "space-grotesk", label: "Space Grotesk", stack: '"Space Grotesk", sans-serif' },
  { id: "inter", label: "Inter", stack: '"Inter", sans-serif' },
  { id: "georgia", label: "Georgia (serif)", stack: 'Georgia, "Times New Roman", serif' },
  { id: "system", label: "Sistema", stack: 'system-ui, -apple-system, sans-serif' },
  { id: "mono", label: "Monospazio", stack: '"Courier New", monospace' },
  { id: "custom", label: "Carica font redazione…", stack: '"Inter", sans-serif' },
];

/** Data color scales for choropleth/symbol layers. */
export interface ColorScale {
  id: string;
  label: string;
  type: "sequenziale" | "divergente" | "categorica";
  colors: string[];
}
export const COLOR_SCALES: ColorScale[] = [
  { id: "teal-seq", label: "Teal", type: "sequenziale", colors: ["#e6f5f6", "#9ad6db", "#32a4ae", "#01646f"] },
  { id: "blue-seq", label: "Blu", type: "sequenziale", colors: ["#eaf2fb", "#9ec5e8", "#4a90d9", "#1b4f8a"] },
  { id: "warm-seq", label: "Caldo", type: "sequenziale", colors: ["#fff3e0", "#ffb74d", "#f57c00", "#bf360c"] },
  { id: "div-rdbu", label: "Rosso–Blu", type: "divergente", colors: ["#b2182b", "#f4a582", "#f7f7f7", "#92c5de", "#2166ac"] },
  { id: "cat", label: "Categorica", type: "categorica", colors: ["#32a4ae", "#f57c00", "#7e57c2", "#43a047", "#e53935"] },
];

/**
 * Newsroom "basekit": the design side of a preset (title font + data color
 * scale + optional logo) that pairs with the map brand in basemap/presets.ts.
 *
 * Keyed by PresetName so {@link applyPreset} can apply brand + design together.
 * `logo` is null until the newsroom supplies its asset (the Design panel keeps
 * a manual logo-upload control); brand colours in presets.ts are placeholders
 * flagged for confirmation with each redazione.
 */
export interface NewsroomKit {
  id: PresetName;
  label: string;
  /** CSS font stack for titles (matches a FONT_OPTIONS stack). */
  titleFont: string;
  /** Default data color scale id (see COLOR_SCALES). */
  colorScale: string;
  /** Public path of the newsroom logo, or null if not yet provided. */
  logo: string | null;
}

export const NEWSROOM_KITS: Record<PresetName, NewsroomKit> = {
  zornade: {
    id: "zornade",
    label: "Zornade",
    titleFont: '"Space Grotesk", sans-serif',
    colorScale: "teal-seq",
    logo: "/zornade-icon.svg",
  },
  corriere: {
    id: "corriere",
    label: "Corriere della Sera",
    titleFont: 'Georgia, "Times New Roman", serif',
    colorScale: "blue-seq",
    logo: null,
  },
  internazionale: {
    id: "internazionale",
    label: "Internazionale",
    titleFont: '"Inter", sans-serif',
    colorScale: "div-rdbu",
    logo: null,
  },
  indipendente: {
    id: "indipendente",
    label: "L'Indipendente",
    titleFont: 'Georgia, "Times New Roman", serif',
    colorScale: "warm-seq",
    logo: null,
  },
  altreconomia: {
    id: "altreconomia",
    label: "Altreconomia",
    titleFont: 'Georgia, "Times New Roman", serif',
    colorScale: "warm-seq",
    logo: null,
  },
};

export const NEWSROOM_KIT_LIST: NewsroomKit[] = Object.values(NEWSROOM_KITS);

/**
 * Basemap choices. OpenFreeMap styles work with NO API key, no usage limits and
 * allow commercial use (MIT; data © OpenMapTiles / OpenStreetMap, attribution
 * auto-added by MapLibre). "none" renders the data on a transparent background.
 * "custom" (a 100% Zornade self-hosted basemap) is on the roadmap.
 */
export interface MapBasemap {
  id: string;
  label: string;
  /** External MapLibre style URL, or null for "no basemap" / "soon". */
  styleUrl: string | null;
  status?: FeatureStatus;
}

const OFM = "https://tiles.openfreemap.org/styles";

export const MAP_BASEMAPS: MapBasemap[] = [
  { id: "ofm-positron", label: "Chiaro (Positron)", styleUrl: `${OFM}/positron` },
  { id: "ofm-bright", label: "Standard (Bright)", styleUrl: `${OFM}/bright` },
  { id: "ofm-liberty", label: "Dettagliato (Liberty)", styleUrl: `${OFM}/liberty` },
  { id: "ofm-dark", label: "Scuro (Dark)", styleUrl: `${OFM}/dark` },
  { id: "none", label: "Nessuna (sfondo trasparente)", styleUrl: null },
  { id: "custom", label: "Basemap Zornade (100%)", styleUrl: null, status: "soon" },
];

export interface NamedOption {
  id: string;
  label: string;
}
export const CLASSIFICATION_METHODS: NamedOption[] = [
  { id: "quantile", label: "Quantili" },
  { id: "jenks", label: "Natural breaks (Jenks)" },
  { id: "equal", label: "Intervalli uguali" },
  { id: "manual", label: "Soglie manuali" },
];
export const LEGEND_TYPES: NamedOption[] = [
  { id: "steps", label: "A gradini" },
  { id: "continuous", label: "Continua" },
  { id: "categorical", label: "Categorica" },
  { id: "size", label: "Di dimensione" },
];

/** Annotation tools (mockup). */
export interface ToolItem {
  id: string;
  label: string;
  icon: LucideIcon;
}
export const ANNOTATION_TOOLS: ToolItem[] = [
  { id: "text", label: "Testo", icon: Type },
  { id: "arrow", label: "Freccia", icon: MoveUpRight },
  { id: "highlight", label: "Evidenzia", icon: Highlighter },
  { id: "marker", label: "Marker", icon: MapPin },
  { id: "line", label: "Linea", icon: Minus },
  { id: "draw", label: "Disegna area", icon: PenTool },
  { id: "image", label: "Immagine", icon: ImageIcon },
];

/** Reader-facing interactivity toggles (mockup). */
export interface ToggleItem {
  id: string;
  label: string;
  desc: string;
}
export const INTERACTION_OPTIONS: ToggleItem[] = [
  { id: "tooltip", label: "Tooltip al passaggio", desc: "Dettagli sotto il cursore" },
  { id: "zoom", label: "Zoom & pan", desc: "Il lettore esplora la mappa" },
  { id: "search", label: "Ricerca / geocoder", desc: "Trova un indirizzo" },
  { id: "filters", label: "Filtri", desc: "Dropdown e slider per il lettore" },
  { id: "timeslider", label: "Time slider", desc: "Animazione temporale (es. OMI 2015→2025)" },
  { id: "clickdetail", label: "Click → dettaglio", desc: "Apri scheda o link" },
];
