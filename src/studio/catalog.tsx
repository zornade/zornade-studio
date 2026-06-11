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
  Leaf,
  AlertTriangle,
  Activity,
  HeartPulse,
  GraduationCap,
  Zap,
  Landmark,
  Bus,
  Palette,
  Building2,
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

/* -------------------------------------------------------------------------- */
/*  Curated catalogue of authoritative Italian (and EU) open-data sources.    */
/*                                                                            */
/*  Every entry links to the official service that EXPOSES the data — the     */
/*  user connects/downloads there, Zornade Studio does not fetch it. URLs and */
/*  endpoints were verified reachable. Searchable by name, provider, theme    */
/*  and keywords. Not all sources are geographic.                            */
/* -------------------------------------------------------------------------- */

export type DataAccess = "api" | "download" | "portal" | "geo";

export interface DataCategory {
  id: string;
  label: string;
  icon: LucideIcon;
}

export const DATA_CATEGORIES: DataCategory[] = [
  { id: "cartografia", label: "Cartografia e confini", icon: MapIcon },
  { id: "statistica", label: "Statistica e demografia", icon: BarChart3 },
  { id: "economia", label: "Economia, lavoro e fisco", icon: TrendingUp },
  { id: "immobiliare", label: "Immobiliare e catasto", icon: Building2 },
  { id: "ambiente", label: "Ambiente e clima", icon: Leaf },
  { id: "rischio", label: "Rischio e territorio", icon: AlertTriangle },
  { id: "sismica", label: "Sismicità e geologia", icon: Activity },
  { id: "salute", label: "Salute", icon: HeartPulse },
  { id: "istruzione", label: "Istruzione", icon: GraduationCap },
  { id: "energia", label: "Energia", icon: Zap },
  { id: "trasparenza", label: "Trasparenza e spesa pubblica", icon: Landmark },
  { id: "elezioni", label: "Elezioni", icon: Vote },
  { id: "mobilita", label: "Mobilità e trasporti", icon: Bus },
  { id: "cultura", label: "Cultura", icon: Palette },
  { id: "poi", label: "Mappe e punti di interesse", icon: MapPin },
  { id: "portali", label: "Portali e cataloghi", icon: Database },
];

export interface DataSourceEntry {
  id: string;
  name: string;
  provider: string;
  category: string;
  description: string;
  /** Official URL where the user connects / downloads the data. */
  url: string;
  access: DataAccess[];
  formats: string[];
  keywords: string[];
  /** Has geographic granularity usable for maps. */
  geo?: boolean;
}

export const DATA_CATALOG: DataSourceEntry[] = [
  // --- Cartografia e confini -------------------------------------------------
  {
    id: "istat-confini",
    name: "Confini amministrativi",
    provider: "ISTAT",
    category: "cartografia",
    description:
      "Limiti di regioni, province/UTS e comuni in formato vettoriale, aggiornati ogni anno.",
    url: "https://www.istat.it/notizia/confini-delle-unita-amministrative-a-fini-statistici-2/",
    access: ["download", "geo"],
    formats: ["Shapefile", "GeoJSON"],
    keywords: ["confini", "limiti amministrativi", "regioni", "province", "comuni", "geometrie", "poligoni"],
    geo: true,
  },
  {
    id: "eurostat-gisco",
    name: "GISCO — confini europei (NUTS)",
    provider: "Eurostat",
    category: "cartografia",
    description:
      "Geometrie amministrative europee a livello NUTS 0/1/2/3 e comuni (LAU).",
    url: "https://ec.europa.eu/eurostat/web/gisco/geodata/administrative-units",
    access: ["download", "geo"],
    formats: ["GeoJSON", "Shapefile", "TopoJSON"],
    keywords: ["nuts", "lau", "europa", "confini", "regioni europee", "geometrie"],
    geo: true,
  },
  {
    id: "geoportale-nazionale",
    name: "Geoportale Nazionale",
    provider: "MASE",
    category: "cartografia",
    description:
      "Cartografia di base nazionale (ortofoto, uso del suolo, idrografia) via servizi WMS/WFS.",
    url: "https://gn.mase.gov.it/portale/",
    access: ["geo", "portal"],
    formats: ["WMS", "WFS", "WCS"],
    keywords: ["ortofoto", "uso del suolo", "idrografia", "wms", "wfs", "cartografia"],
    geo: true,
  },
  {
    id: "rndt",
    name: "RNDT — Repertorio Nazionale Dati Territoriali",
    provider: "AgID",
    category: "cartografia",
    description:
      "Catalogo nazionale dei dati e servizi territoriali della Pubblica Amministrazione (CSW).",
    url: "https://geodati.gov.it/geoportale/",
    access: ["portal", "geo"],
    formats: ["CSW", "WMS", "metadati"],
    keywords: ["catalogo", "territorio", "metadati", "inspire", "csw", "geodati"],
    geo: true,
  },

  // --- Statistica e demografia ----------------------------------------------
  {
    id: "istat-esplora",
    name: "Esplora Dati ISTAT (I.Stat)",
    provider: "ISTAT",
    category: "statistica",
    description:
      "Tutte le statistiche ufficiali italiane: popolazione, lavoro, prezzi, imprese. API SDMX.",
    url: "https://esploradati.istat.it/databrowser/",
    access: ["api", "download"],
    formats: ["SDMX", "CSV", "JSON"],
    keywords: ["istat", "popolazione", "demografia", "censimento", "occupazione", "prezzi", "statistiche", "sdmx"],
  },
  {
    id: "istat-demo",
    name: "Demografia in cifre (GeoDemo)",
    provider: "ISTAT",
    category: "statistica",
    description:
      "Popolazione residente, bilancio demografico, stranieri, età per comune e provincia.",
    url: "https://demo.istat.it/",
    access: ["download"],
    formats: ["CSV", "Excel"],
    keywords: ["popolazione residente", "nascite", "morti", "stranieri", "età media", "comuni"],
    geo: true,
  },
  {
    id: "eurostat-db",
    name: "Eurostat Database",
    provider: "Commissione Europea",
    category: "statistica",
    description:
      "Statistiche europee comparabili tra Stati e regioni. API SDMX e REST.",
    url: "https://ec.europa.eu/eurostat/data/database",
    access: ["api", "download"],
    formats: ["SDMX", "TSV", "JSON"],
    keywords: ["europa", "comparazione", "regioni", "pil", "popolazione", "sdmx"],
  },

  // --- Economia, lavoro e fisco ---------------------------------------------
  {
    id: "bankitalia-bds",
    name: "Base Dati Statistica (BDS)",
    provider: "Banca d'Italia",
    category: "economia",
    description:
      "Statistiche su credito, finanza pubblica, bilancia dei pagamenti, economie regionali.",
    url: "https://www.bancaditalia.it/statistiche/index.html",
    access: ["api", "download"],
    formats: ["SDMX", "CSV"],
    keywords: ["banca d'italia", "credito", "debito", "finanza pubblica", "economie regionali", "tassi"],
  },
  {
    id: "mef-redditi",
    name: "Dichiarazioni dei redditi",
    provider: "MEF — Dip. Finanze",
    category: "economia",
    description:
      "Redditi dichiarati e imposte per comune e regione, serie storiche annuali.",
    url: "https://www1.finanze.gov.it/finanze/analisi_stat/public/index.php?tree=2024",
    access: ["download"],
    formats: ["CSV", "Excel"],
    keywords: ["redditi", "irpef", "imposte", "fisco", "reddito medio", "comuni"],
    geo: true,
  },
  {
    id: "inps-osservatori",
    name: "Osservatori statistici INPS",
    provider: "INPS",
    category: "economia",
    description:
      "Pensioni, lavoratori dipendenti e autonomi, cassa integrazione, NASpI per territorio.",
    url: "https://www.inps.it/it/it/dati-e-bilanci/osservatori-statistici-e-altre-statistiche.html",
    access: ["download", "portal"],
    formats: ["CSV", "Excel"],
    keywords: ["pensioni", "lavoro", "cassa integrazione", "naspi", "contributi", "occupati"],
    geo: true,
  },
  {
    id: "inail-opendata",
    name: "Open Data INAIL",
    provider: "INAIL",
    category: "economia",
    description:
      "Infortuni sul lavoro e malattie professionali, denunce per territorio e settore.",
    url: "https://dati.inail.it/opendata/default/Daticompleti/index.html",
    access: ["download", "api"],
    formats: ["CSV", "JSON"],
    keywords: ["infortuni", "lavoro", "sicurezza", "malattie professionali", "denunce"],
    geo: true,
  },

  // --- Immobiliare e catasto -------------------------------------------------
  {
    id: "omi",
    name: "Quotazioni immobiliari (OMI)",
    provider: "Agenzia delle Entrate",
    category: "immobiliare",
    description:
      "Valori di compravendita e locazione al m² per zona OMI, semestrali. Base dati nazionale.",
    url: "https://www.agenziaentrate.gov.it/portale/web/guest/schede/fabbricatiterreni/omi/banche-dati/quotazioni-immobiliari",
    access: ["download"],
    formats: ["CSV", "TXT"],
    keywords: ["omi", "prezzi case", "immobili", "compravendita", "affitti", "mercato immobiliare", "€/m²"],
    geo: true,
  },
  {
    id: "ae-mercato",
    name: "Statistiche del mercato immobiliare",
    provider: "Agenzia delle Entrate",
    category: "immobiliare",
    description:
      "Compravendite (NTN), mutui e andamento del mercato residenziale e non residenziale.",
    url: "https://www.agenziaentrate.gov.it/portale/web/guest/schede/fabbricatiterreni/omi/pubblicazioni/statistiche",
    access: ["download"],
    formats: ["Excel", "PDF"],
    keywords: ["compravendite", "ntn", "mutui", "mercato immobiliare", "transazioni"],
    geo: true,
  },

  // --- Ambiente e clima ------------------------------------------------------
  {
    id: "ispra-consumo-suolo",
    name: "Consumo di suolo",
    provider: "ISPRA / SNPA",
    category: "ambiente",
    description:
      "Suolo consumato per regione, provincia e comune; serie 2006→oggi da cartografia satellitare.",
    url: "https://www.isprambiente.gov.it/it/attivita/suolo-e-territorio/suolo/il-consumo-di-suolo/i-dati-sul-consumo-di-suolo",
    access: ["download", "geo"],
    formats: ["CSV", "Excel", "GeoTIFF"],
    keywords: ["consumo di suolo", "cemento", "impermeabilizzazione", "urbanizzazione", "ispra"],
    geo: true,
  },
  {
    id: "ispra-annuario",
    name: "Annuario dei dati ambientali",
    provider: "ISPRA",
    category: "ambiente",
    description:
      "Indicatori su aria, acqua, rifiuti, natura, clima e rischi a copertura nazionale.",
    url: "https://annuario.isprambiente.it/",
    access: ["portal", "download"],
    formats: ["CSV", "Excel"],
    keywords: ["aria", "acqua", "rifiuti", "clima", "biodiversità", "indicatori ambientali"],
  },
  {
    id: "copernicus-clms",
    name: "Copernicus Land Monitoring (CLMS)",
    provider: "Commissione Europea / ESA",
    category: "ambiente",
    description:
      "Uso e copertura del suolo (CORINE), aree urbane, foreste, acque da satellite Sentinel.",
    url: "https://land.copernicus.eu/en",
    access: ["download", "geo"],
    formats: ["GeoTIFF", "WMS", "raster"],
    keywords: ["corine", "uso del suolo", "satellite", "sentinel", "copertura del suolo", "foreste"],
    geo: true,
  },
  {
    id: "copernicus-cds",
    name: "Climate Data Store",
    provider: "Copernicus (C3S)",
    category: "ambiente",
    description:
      "Dati climatici e meteo: temperatura, precipitazioni, rianalisi ERA5, proiezioni.",
    url: "https://cds.climate.copernicus.eu/",
    access: ["api", "download"],
    formats: ["NetCDF", "GRIB", "CSV"],
    keywords: ["clima", "temperatura", "precipitazioni", "era5", "meteo", "riscaldamento"],
    geo: true,
  },
  {
    id: "eea-datahub",
    name: "EEA Datahub",
    provider: "Agenzia Europea Ambiente",
    category: "ambiente",
    description:
      "Qualità dell'aria, emissioni, clima e natura a scala europea, con confronti tra Paesi.",
    url: "https://www.eea.europa.eu/en/datahub",
    access: ["api", "download"],
    formats: ["CSV", "GeoJSON", "API"],
    keywords: ["qualità aria", "emissioni", "co2", "inquinamento", "europa", "clima"],
    geo: true,
  },

  // --- Rischio e territorio --------------------------------------------------
  {
    id: "ispra-idrogeo",
    name: "IdroGEO — dissesto idrogeologico",
    provider: "ISPRA",
    category: "rischio",
    description:
      "Pericolosità da frane e alluvioni, popolazione e beni esposti per comune. API aperta.",
    url: "https://idrogeo.isprambiente.it/app/",
    access: ["api", "geo", "download"],
    formats: ["JSON", "GeoJSON", "API"],
    keywords: ["frane", "alluvioni", "dissesto", "rischio idrogeologico", "pericolosità", "esposizione"],
    geo: true,
  },
  {
    id: "protezione-civile-rischi",
    name: "Mappe rischi e allerte",
    provider: "Protezione Civile",
    category: "rischio",
    description:
      "Bollettini di criticità, allerte meteo-idro e mappe di rischio nazionali.",
    url: "https://mappe.protezionecivile.gov.it/it/mappe-rischi/",
    access: ["portal", "geo"],
    formats: ["WMS", "PDF"],
    keywords: ["allerta meteo", "criticità", "protezione civile", "rischio", "emergenze"],
    geo: true,
  },

  // --- Sismicità e geologia --------------------------------------------------
  {
    id: "ingv-terremoti",
    name: "Catalogo terremoti (FDSN/ISIDe)",
    provider: "INGV",
    category: "sismica",
    description:
      "Tutti gli eventi sismici in Italia con magnitudo, profondità e coordinate. API FDSN.",
    url: "https://terremoti.ingv.it/",
    access: ["api", "download"],
    formats: ["CSV", "QuakeML", "GeoJSON", "API"],
    keywords: ["terremoti", "sismi", "magnitudo", "epicentro", "ingv", "scosse"],
    geo: true,
  },

  // --- Salute ----------------------------------------------------------------
  {
    id: "salute-opendata",
    name: "Open Data Ministero della Salute",
    provider: "Ministero della Salute",
    category: "salute",
    description:
      "Strutture sanitarie, posti letto, personale, assistenza e flussi per regione e ASL.",
    url: "https://www.salute.gov.it/portale/documentazione/p6_2.jsp?area=open-data",
    access: ["download", "portal"],
    formats: ["CSV", "Excel"],
    keywords: ["sanità", "ospedali", "posti letto", "asl", "medici", "assistenza"],
    geo: true,
  },
  {
    id: "pcm-covid",
    name: "Dati COVID-19",
    provider: "Protezione Civile",
    category: "salute",
    description:
      "Serie storiche nazionali, regionali e provinciali della pandemia COVID-19.",
    url: "https://github.com/pcm-dpc/COVID-19",
    access: ["download", "api"],
    formats: ["CSV", "JSON"],
    keywords: ["covid", "pandemia", "contagi", "vaccini", "ricoveri", "serie storica"],
    geo: true,
  },

  // --- Istruzione ------------------------------------------------------------
  {
    id: "mim-scuola",
    name: "Open Data Scuola",
    provider: "Min. Istruzione e Merito",
    category: "istruzione",
    description:
      "Anagrafe scuole, studenti, edilizia scolastica, esiti e personale per istituto.",
    url: "https://dati.istruzione.it/opendata/",
    access: ["download", "portal"],
    formats: ["CSV"],
    keywords: ["scuole", "studenti", "edilizia scolastica", "istituti", "iscritti", "docenti"],
    geo: true,
  },

  // --- Energia ---------------------------------------------------------------
  {
    id: "terna",
    name: "Transparency Report / Download Center",
    provider: "Terna",
    category: "energia",
    description:
      "Domanda, produzione e mix elettrico nazionale in tempo quasi reale e storico.",
    url: "https://www.terna.it/it/sistema-elettrico/transparency-report",
    access: ["api", "download"],
    formats: ["CSV", "Excel", "API"],
    keywords: ["energia elettrica", "consumi", "produzione", "rinnovabili", "rete", "carico"],
  },
  {
    id: "gse-opendata",
    name: "Open Data GSE",
    provider: "GSE",
    category: "energia",
    description:
      "Impianti e produzione da fonti rinnovabili (fotovoltaico, eolico, idro) per territorio.",
    url: "https://www.gse.it/dati-e-scenari/open-data",
    access: ["download", "portal"],
    formats: ["CSV", "Excel"],
    keywords: ["rinnovabili", "fotovoltaico", "eolico", "incentivi", "impianti", "energia"],
    geo: true,
  },

  // --- Trasparenza e spesa pubblica -----------------------------------------
  {
    id: "anac",
    name: "Open Data contratti pubblici",
    provider: "ANAC",
    category: "trasparenza",
    description:
      "Appalti, bandi, aggiudicazioni e contratti pubblici con stazioni appaltanti e importi.",
    url: "https://dati.anticorruzione.it/",
    access: ["download", "api"],
    formats: ["CSV", "JSON", "API"],
    keywords: ["appalti", "bandi", "gare", "contratti pubblici", "corruzione", "spesa"],
    geo: true,
  },
  {
    id: "opencoesione",
    name: "OpenCoesione",
    provider: "Dip. Politiche di Coesione",
    category: "trasparenza",
    description:
      "Progetti finanziati dai fondi di coesione UE e nazionali, con luoghi, importi e stato.",
    url: "https://opencoesione.gov.it/it/opendata/",
    access: ["download", "api"],
    formats: ["CSV", "JSON"],
    keywords: ["fondi europei", "coesione", "progetti", "investimenti", "pnrr", "finanziamenti"],
    geo: true,
  },
  {
    id: "soldipubblici",
    name: "Soldi Pubblici",
    provider: "AgID / RGS",
    category: "trasparenza",
    description:
      "Quanto spendono le amministrazioni pubbliche, per ente e categoria di spesa.",
    url: "https://soldipubblici.gov.it/it/home",
    access: ["portal", "api"],
    formats: ["JSON", "API"],
    keywords: ["spesa pubblica", "pagamenti", "enti", "bilancio", "siope"],
    geo: true,
  },

  // --- Elezioni --------------------------------------------------------------
  {
    id: "eligendo",
    name: "Eligendo — risultati elettorali",
    provider: "Ministero dell'Interno",
    category: "elezioni",
    description:
      "Risultati e affluenza di elezioni politiche, europee, regionali e referendum.",
    url: "https://elezioni.interno.gov.it/opendata",
    access: ["download"],
    formats: ["CSV"],
    keywords: ["elezioni", "voti", "affluenza", "referendum", "politiche", "europee", "regionali"],
    geo: true,
  },

  // --- Mobilità e trasporti --------------------------------------------------
  {
    id: "aci",
    name: "Dati e statistiche ACI",
    provider: "ACI",
    category: "mobilita",
    description:
      "Parco veicolare, immatricolazioni e incidentalità stradale per provincia e comune.",
    url: "https://www.aci.it/laci/studi-e-ricerche/dati-e-statistiche.html",
    access: ["download", "portal"],
    formats: ["Excel", "CSV"],
    keywords: ["auto", "veicoli", "immatricolazioni", "incidenti stradali", "parco veicolare"],
    geo: true,
  },

  // --- Cultura ---------------------------------------------------------------
  {
    id: "mic-opendata",
    name: "Open Data Cultura",
    provider: "Ministero della Cultura",
    category: "cultura",
    description:
      "Luoghi della cultura, musei, biblioteche, archivi e visitatori dei siti statali.",
    url: "https://dati.cultura.gov.it/",
    access: ["download", "portal", "api"],
    formats: ["CSV", "JSON", "RDF"],
    keywords: ["musei", "biblioteche", "archivi", "beni culturali", "visitatori", "patrimonio"],
    geo: true,
  },

  // --- Mappe e POI -----------------------------------------------------------
  {
    id: "osm-overpass",
    name: "OpenStreetMap (Overpass)",
    provider: "OpenStreetMap",
    category: "poi",
    description:
      "Qualsiasi oggetto mappato: scuole, ospedali, fermate, negozi, parchi. Query via Overpass.",
    url: "https://overpass-turbo.eu/",
    access: ["api", "geo"],
    formats: ["GeoJSON", "OSM", "API"],
    keywords: ["osm", "punti di interesse", "poi", "scuole", "ospedali", "fermate", "negozi", "parchi"],
    geo: true,
  },

  // --- Portali e cataloghi ---------------------------------------------------
  {
    id: "dati-gov",
    name: "dati.gov.it — catalogo nazionale",
    provider: "AgID",
    category: "portali",
    description:
      "Punto di accesso unico agli open data della PA italiana. Migliaia di dataset (CKAN).",
    url: "https://www.dati.gov.it/",
    access: ["portal", "api"],
    formats: ["CKAN", "CSV", "JSON"],
    keywords: ["catalogo", "open data", "pubblica amministrazione", "ckan", "dataset"],
  },
  {
    id: "dati-lombardia",
    name: "Open Data Lombardia",
    provider: "Regione Lombardia",
    category: "portali",
    description:
      "Dati regionali su ambiente, sanità, mobilità e sensori (piattaforma Socrata, API).",
    url: "https://www.dati.lombardia.it/",
    access: ["portal", "api"],
    formats: ["CSV", "JSON", "API"],
    keywords: ["lombardia", "regione", "sensori", "qualità aria", "socrata"],
    geo: true,
  },
  {
    id: "dati-emilia",
    name: "Open Data Emilia-Romagna",
    provider: "Regione Emilia-Romagna",
    category: "portali",
    description: "Catalogo regionale CKAN: ambiente, salute, mobilità, turismo.",
    url: "https://dati.emilia-romagna.it/",
    access: ["portal", "api"],
    formats: ["CKAN", "CSV", "JSON"],
    keywords: ["emilia-romagna", "regione", "ckan", "turismo"],
    geo: true,
  },
  {
    id: "dati-toscana",
    name: "Open Data Toscana",
    provider: "Regione Toscana",
    category: "portali",
    description: "Catalogo regionale CKAN con dati territoriali, sanitari ed economici.",
    url: "https://dati.toscana.it/",
    access: ["portal", "api"],
    formats: ["CKAN", "CSV", "JSON"],
    keywords: ["toscana", "regione", "ckan"],
    geo: true,
  },
  {
    id: "dati-piemonte",
    name: "Open Data Piemonte",
    provider: "Regione Piemonte",
    category: "portali",
    description: "Catalogo regionale con dati su territorio, ambiente, sanità e cultura.",
    url: "https://www.dati.piemonte.it/",
    access: ["portal", "api"],
    formats: ["CKAN", "CSV", "JSON"],
    keywords: ["piemonte", "regione", "ckan"],
    geo: true,
  },
  {
    id: "dati-milano",
    name: "Open Data Comune di Milano",
    provider: "Comune di Milano",
    category: "portali",
    description: "Dati comunali: anagrafe, mobilità, urbanistica, bilancio (CKAN).",
    url: "https://dati.comune.milano.it/",
    access: ["portal", "api"],
    formats: ["CKAN", "CSV", "GeoJSON"],
    keywords: ["milano", "comune", "città", "ckan", "urbanistica"],
    geo: true,
  },
  {
    id: "dati-roma",
    name: "Open Data Roma Capitale",
    provider: "Roma Capitale",
    category: "portali",
    description: "Dati comunali di Roma: mobilità, demografia, servizi, bilancio (CKAN).",
    url: "https://dati.comune.roma.it/",
    access: ["portal", "api"],
    formats: ["CKAN", "CSV", "GeoJSON"],
    keywords: ["roma", "comune", "città", "ckan"],
    geo: true,
  },
  {
    id: "dati-napoli",
    name: "Open Data Comune di Napoli",
    provider: "Comune di Napoli",
    category: "portali",
    description: "Dati comunali di Napoli: territorio, servizi, bilancio (CKAN).",
    url: "https://dati.comune.napoli.it/",
    access: ["portal", "api"],
    formats: ["CKAN", "CSV"],
    keywords: ["napoli", "comune", "città", "ckan"],
    geo: true,
  },
];

/** Free-text search over the data catalogue (name, provider, theme, keywords). */
export function searchDataCatalog(
  query: string,
  category: string | null,
): DataSourceEntry[] {
  const q = query.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  return DATA_CATALOG.filter((e) => {
    if (category && e.category !== category) return false;
    if (tokens.length === 0) return true;
    const catLabel =
      DATA_CATEGORIES.find((c) => c.id === e.category)?.label ?? "";
    const haystack = [
      e.name,
      e.provider,
      e.description,
      catLabel,
      e.formats.join(" "),
      e.keywords.join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return tokens.every((t) => haystack.includes(t));
  });
}

const ACCESS_META: Record<DataAccess, string> = {
  api: "API",
  download: "Download",
  portal: "Portale",
  geo: "Geo",
};

export function accessLabel(a: DataAccess): string {
  return ACCESS_META[a];
}

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
  { id: "custom", label: "Custom", styleUrl: null, status: "soon" },
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
