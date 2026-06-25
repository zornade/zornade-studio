/**
 * Catalogo curato dei dataset Eurostat utili per le mappe italiane.
 *
 * Ogni entry è verificata live contro l'API SDMX-JSON di Eurostat
 * (https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{CODE}).
 * Aggiornato: 2026-06-25.
 *
 * Per i dataset con granularità NUTS2/NUTS3, omettere il filtro `geo=IT`:
 * i dati sono sotto i codici NUTS2 (ITC1..ITG2) / NUTS3 (ITC11..ITG22).
 */

/** Granularità geografica disponibile per un dataset. */
export type EurostatGeo = "paese" | "nuts2" | "nuts3";

/** Una dimensione del dataset (es. sex, age, unit…). */
export interface EurostatDim {
  /** Codice Eurostat della dimensione (es. "sex", "age"). */
  id: string;
  /** Label leggibile. */
  label: string;
  /** Valori selezionabili — se presente, mostrare come filtro opzionale. */
  values?: Record<string, string>;
}

/** Colonna normalizzata prodotta dalla conversione SDMX → tabella piatta. */
export interface EurostatColumn {
  /** Nome della colonna nel CSV di output. */
  name: string;
  /** Tipo semantico. */
  type: "string" | "number" | "year" | "geo";
  /** Descrizione estesa. */
  desc: string;
}

export type EurostatTheme =
  | "demografia"
  | "economia"
  | "abitazioni"
  | "ambiente"
  | "lavoro"
  | "turismo"
  | "trasporti"
  | "salute"
  | "istruzione";

export interface EurostatDataset {
  /** Codice identificativo Eurostat (es. "DEMO_R_D3DENS"). */
  code: string;
  /** Label breve per il menu. */
  label: string;
  /** Descrizione estesa (una frase). */
  desc: string;
  /** Tema per raggruppamento nel menu. */
  theme: EurostatTheme;
  /** Granularità geografica massima disponibile per Italia. */
  geo: EurostatGeo;
  /** Intervallo temporale disponibile (inclusi). */
  timeRange: [number, number];
  /** Ultima data di aggiornamento Eurostat. */
  updated: string;
  /** Colonne prodotte dal proxy dopo la normalizzazione. */
  columns: EurostatColumn[];
  /**
   * Dimensioni da passare come filtri all'API.
   * Il proxy usa questi valori di default per ridurre le dimensioni della
   * risposta. L'utente può sovrascriverli nell'UI (opzionale).
   */
  defaultFilters?: Record<string, string>;
  /** Link alla scheda ufficiale Eurostat. */
  landing: string;
}

// ── NUTS2 italiane (21 regioni SDMX) ───────────────────────────────────────
export const IT_NUTS2: Record<string, string> = {
  ITC1: "Piemonte",
  ITC2: "Valle d'Aosta",
  ITC3: "Liguria",
  ITC4: "Lombardia",
  ITF1: "Abruzzo",
  ITF2: "Molise",
  ITF3: "Campania",
  ITF4: "Puglia",
  ITF5: "Basilicata",
  ITF6: "Calabria",
  ITG1: "Sicilia",
  ITG2: "Sardegna",
  ITH1: "P.A. Bolzano",
  ITH2: "P.A. Trento",
  ITH3: "Veneto",
  ITH4: "Friuli-Venezia Giulia",
  ITH5: "Emilia-Romagna",
  ITI1: "Toscana",
  ITI2: "Umbria",
  ITI3: "Marche",
  ITI4: "Lazio",
};

// ── Dataset curati ──────────────────────────────────────────────────────────

export const EUROSTAT_DATASETS: EurostatDataset[] = [
  // === DEMOGRAFIA ============================================================
  {
    code: "DEMO_R_D3DENS",
    label: "Densità demografica",
    desc: "Abitanti per km² per regione NUTS3. Serie storica 1990–2024.",
    theme: "demografia",
    geo: "nuts3",
    timeRange: [1990, 2024],
    updated: "2026-02-25",
    columns: [
      { name: "geo", type: "geo", desc: "Codice NUTS3 (es. ITC11)" },
      { name: "geo_label", type: "string", desc: "Nome regione/provincia" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "density", type: "number", desc: "Abitanti per km²" },
    ],
    landing: "https://ec.europa.eu/eurostat/databrowser/view/DEMO_R_D3DENS",
  },
  {
    code: "DEMO_R_PJANGRP3",
    label: "Popolazione per età e sesso",
    desc: "Popolazione residente per NUTS3, fascia d'età (22 classi), sesso. Anni 2014–2025.",
    theme: "demografia",
    geo: "nuts3",
    timeRange: [2014, 2025],
    updated: "2026-06-11",
    columns: [
      { name: "geo", type: "geo", desc: "Codice NUTS3" },
      { name: "geo_label", type: "string", desc: "Nome regione/provincia" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "sex", type: "string", desc: "Sesso (T/M/F)" },
      { name: "age", type: "string", desc: "Fascia d'età (es. Y15-19)" },
      { name: "population", type: "number", desc: "Numero di abitanti" },
    ],
    defaultFilters: { unit: "NR", sex: "T" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/DEMO_R_PJANGRP3",
  },

  // === ECONOMIA ==============================================================
  {
    code: "NAMA_10R_3GDP",
    label: "PIL per provincia (NUTS3)",
    desc: "Prodotto Interno Lordo regionale per NUTS3. Disponibile in PPS, EUR, indice. Anni 2000–2024.",
    theme: "economia",
    geo: "nuts3",
    timeRange: [2000, 2024],
    updated: "2026-02-10",
    columns: [
      { name: "geo", type: "geo", desc: "Codice NUTS3" },
      { name: "geo_label", type: "string", desc: "Nome provincia" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "unit", type: "string", desc: "Unità (MIO_EUR, MIO_PPS_EU27_2020, …)" },
      { name: "gdp", type: "number", desc: "Valore PIL" },
    ],
    defaultFilters: { unit: "MIO_EUR" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/NAMA_10R_3GDP",
  },
  {
    code: "NAMA_10R_2GDP",
    label: "PIL per regione (NUTS2)",
    desc: "Prodotto Interno Lordo regionale per NUTS2. Disponibile in PPS, EUR, indice. Anni 2000–2024.",
    theme: "economia",
    geo: "nuts2",
    timeRange: [2000, 2024],
    updated: "2026-02-10",
    columns: [
      { name: "geo", type: "geo", desc: "Codice NUTS2" },
      { name: "geo_label", type: "string", desc: "Nome regione" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "unit", type: "string", desc: "Unità (MIO_EUR, MIO_PPS_EU27_2020, …)" },
      { name: "gdp", type: "number", desc: "Valore PIL" },
    ],
    defaultFilters: { unit: "MIO_EUR" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/NAMA_10R_2GDP",
  },
  {
    code: "ILC_LI41",
    label: "Tasso di rischio povertà (NUTS2)",
    desc: "Percentuale di persone a rischio povertà per regione NUTS2. Anni 2003–2025.",
    theme: "economia",
    geo: "nuts2",
    timeRange: [2003, 2025],
    updated: "2026-06-08",
    columns: [
      { name: "geo", type: "geo", desc: "Codice NUTS2" },
      { name: "geo_label", type: "string", desc: "Nome regione" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "poverty_rate", type: "number", desc: "% persone a rischio povertà" },
    ],
    defaultFilters: { unit: "PC" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/ILC_LI41",
  },
  {
    code: "ILC_DI01",
    label: "Distribuzione reddito per quintile",
    desc: "Distribuzione del reddito disponibile per quintile. Livello paese. Anni 1995–2025.",
    theme: "economia",
    geo: "paese",
    timeRange: [1995, 2025],
    updated: "2026-06-08",
    columns: [
      { name: "geo", type: "geo", desc: "Codice paese (IT)" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "quantile", type: "string", desc: "Quintile (es. QU1..QU5)" },
      { name: "statinfo", type: "string", desc: "Statistico (media, totale)" },
      { name: "unit", type: "string", desc: "Unità" },
      { name: "value", type: "number", desc: "Valore" },
    ],
    landing: "https://ec.europa.eu/eurostat/databrowser/view/ILC_DI01",
  },

  // === ABITAZIONI ============================================================
  {
    code: "ILC_LVHO01",
    label: "Tasso sovraffollamento abitativo",
    desc: "% famiglie in abitazioni sovraffollate per grado di urbanizzazione e rischio povertà. Anni 2003–2025.",
    theme: "abitazioni",
    geo: "paese",
    timeRange: [2003, 2025],
    updated: "2026-06-08",
    columns: [
      { name: "geo", type: "geo", desc: "Codice paese" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "deg_urb", type: "string", desc: "Grado urbanizzazione (TOTAL/DEG1/DEG2/DEG3)" },
      { name: "rskpovth", type: "string", desc: "Soglia rischio povertà" },
      { name: "building", type: "string", desc: "Tipo edificio" },
      { name: "overcrowding_rate", type: "number", desc: "% abitazioni sovraffollate" },
    ],
    defaultFilters: { unit: "PC", deg_urb: "TOTAL", rskpovth: "TOTAL", building: "TOTAL" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/ILC_LVHO01",
  },
  {
    code: "ILC_MDHO06A",
    label: "Deprivazione abitativa grave",
    desc: "% persone in abitazioni con gravi carenze strutturali, per età e sesso. Anni 2003–2023.",
    theme: "abitazioni",
    geo: "paese",
    timeRange: [2003, 2023],
    updated: "2026-05-21",
    columns: [
      { name: "geo", type: "geo", desc: "Codice paese" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "sex", type: "string", desc: "Sesso" },
      { name: "age", type: "string", desc: "Fascia d'età" },
      { name: "rskpovth", type: "string", desc: "Soglia rischio povertà" },
      { name: "deprivation_rate", type: "number", desc: "% persone in deprivazione abitativa grave" },
    ],
    defaultFilters: { unit: "PC", sex: "T", age: "TOTAL", rskpovth: "TOTAL" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/ILC_MDHO06A",
  },

  // === AMBIENTE ==============================================================
  {
    code: "ENV_AC_AINAH_R2",
    label: "Emissioni in aria per settore (NUTS2)",
    desc: "Emissioni atmosferiche (NOx, CO2, PM2.5…) per settore NACE Rev.2 a livello NUTS2. Anni 1995–2025.",
    theme: "ambiente",
    geo: "nuts2",
    timeRange: [1995, 2025],
    updated: "2026-06-16",
    columns: [
      { name: "geo", type: "geo", desc: "Codice NUTS2" },
      { name: "geo_label", type: "string", desc: "Nome regione" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "airpol", type: "string", desc: "Inquinante (CO2, NOX, PM2_5, …)" },
      { name: "nace_r2", type: "string", desc: "Settore economico NACE Rev.2" },
      { name: "unit", type: "string", desc: "Unità di misura" },
      { name: "emission", type: "number", desc: "Valore emissioni" },
    ],
    defaultFilters: { airpol: "CO2", nace_r2: "TOTAL", unit: "THS_T" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/ENV_AC_AINAH_R2",
  },
  {
    code: "NRG_CHDDR2_A",
    label: "Gradi-giorno riscaldamento/raffrescamento (NUTS3)",
    desc: "Heating Degree Days e Cooling Degree Days per provincia NUTS3. Anni 1980–2025.",
    theme: "ambiente",
    geo: "nuts3",
    timeRange: [1980, 2025],
    updated: "2026-05-08",
    columns: [
      { name: "geo", type: "geo", desc: "Codice NUTS3" },
      { name: "geo_label", type: "string", desc: "Nome provincia" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "indic_nrg", type: "string", desc: "Indicatore (HDD / CDD)" },
      { name: "value", type: "number", desc: "Gradi-giorno" },
    ],
    defaultFilters: { unit: "NR", indic_nrg: "HDD" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/NRG_CHDDR2_A",
  },
  {
    code: "SDG_14_40",
    label: "Qualità acque di balneazione",
    desc: "% acque costiere e interne conformi agli standard di qualità. Anni 2011–2024.",
    theme: "ambiente",
    geo: "paese",
    timeRange: [2011, 2024],
    updated: "2026-04-28",
    columns: [
      { name: "geo", type: "geo", desc: "Codice paese" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "aquaenv", type: "string", desc: "Tipo acque (TOTAL/COAST/INLAND/…)" },
      { name: "unit", type: "string", desc: "Unità" },
      { name: "quality_pct", type: "number", desc: "% acque conformi" },
    ],
    defaultFilters: { unit: "PC", aquaenv: "TOTAL" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/SDG_14_40",
  },

  // === LAVORO ===============================================================
  {
    code: "LFST_R_LFP2ACTRT",
    label: "Tasso di attività per regione (NUTS2)",
    desc: "% popolazione attiva (15–74 anni) per regione NUTS2, età e sesso. Anni 1999–2025.",
    theme: "lavoro",
    geo: "nuts2",
    timeRange: [1999, 2025],
    updated: "2026-06-11",
    columns: [
      { name: "geo", type: "geo", desc: "Codice NUTS2" },
      { name: "geo_label", type: "string", desc: "Nome regione" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "sex", type: "string", desc: "Sesso (T/M/F)" },
      { name: "age", type: "string", desc: "Fascia d'età" },
      { name: "activity_rate", type: "number", desc: "Tasso di attività (%)" },
    ],
    defaultFilters: { unit: "PC", sex: "T", age: "Y15-74" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/LFST_R_LFP2ACTRT",
  },
  {
    code: "TGS00010",
    label: "Tasso di disoccupazione (NUTS2)",
    desc: "Tasso di disoccupazione per regione NUTS2, sesso e istruzione. Anni 2014–2025.",
    theme: "lavoro",
    geo: "nuts2",
    timeRange: [2014, 2025],
    updated: "2026-06-11",
    columns: [
      { name: "geo", type: "geo", desc: "Codice NUTS2" },
      { name: "geo_label", type: "string", desc: "Nome regione" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "sex", type: "string", desc: "Sesso (T/M/F)" },
      { name: "isced11", type: "string", desc: "Livello istruzione (TOTAL/ED0-2/ED3-8)" },
      { name: "unemployment_rate", type: "number", desc: "Tasso di disoccupazione (%)" },
    ],
    defaultFilters: { unit: "PC", sex: "T", age: "Y15-74", isced11: "TOTAL" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/TGS00010",
  },

  // === TURISMO ==============================================================
  {
    code: "TGS00111",
    label: "Pernottamenti turistici (NUTS2)",
    desc: "Notti trascorse in strutture ricettive per regione NUTS2 e provenienza. Anni 2014–2025.",
    theme: "turismo",
    geo: "nuts2",
    timeRange: [2014, 2025],
    updated: "2026-06-24",
    columns: [
      { name: "geo", type: "geo", desc: "Codice NUTS2" },
      { name: "geo_label", type: "string", desc: "Nome regione" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "c_resid", type: "string", desc: "Provenienza (TOTAL/DOM/FOR)" },
      { name: "nights", type: "number", desc: "Numero di pernottamenti" },
    ],
    defaultFilters: { unit: "NR", c_resid: "TOTAL", nace_r2: "I551-I553" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/TGS00111",
  },
  {
    code: "TOUR_OCC_NIN2M",
    label: "Pernottamenti turistici per mese (NUTS2)",
    desc: "Notti trascorse in strutture ricettive per regione NUTS2 e mese. Anni 2020–2025.",
    theme: "turismo",
    geo: "nuts2",
    timeRange: [2020, 2025],
    updated: "2026-06-24",
    columns: [
      { name: "geo", type: "geo", desc: "Codice NUTS2" },
      { name: "geo_label", type: "string", desc: "Nome regione" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "month", type: "string", desc: "Mese (M01..M12 o TOTAL)" },
      { name: "c_resid", type: "string", desc: "Provenienza (TOTAL/DOM/FOR)" },
      { name: "unit", type: "string", desc: "Unità" },
      { name: "nights", type: "number", desc: "Numero di pernottamenti" },
    ],
    defaultFilters: { c_resid: "TOTAL", nace_r2: "I551-I553", unit: "NR" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/TOUR_OCC_NIN2M",
  },
  {
    code: "TOUR_OCC_ARNAT",
    label: "Arrivi turistici per nazionalità",
    desc: "Arrivi in strutture ricettive per nazionalità degli ospiti. Livello paese. Anni 1990–2025.",
    theme: "turismo",
    geo: "paese",
    timeRange: [1990, 2025],
    updated: "2026-06-24",
    columns: [
      { name: "geo", type: "geo", desc: "Codice paese" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "c_resid", type: "string", desc: "Provenienza (TOTAL/DOM/FOR)" },
      { name: "nace_r2", type: "string", desc: "Tipo struttura ricettiva" },
      { name: "unit", type: "string", desc: "Unità (NR / THS)" },
      { name: "arrivals", type: "number", desc: "Numero di arrivi" },
    ],
    defaultFilters: { unit: "NR", c_resid: "TOTAL", nace_r2: "I551-I553" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/TOUR_OCC_ARNAT",
  },

  // === TRASPORTI ============================================================
  {
    code: "TRAN_R_VEHST",
    label: "Veicoli circolanti per regione (NUTS2)",
    desc: "Parco veicoli per categoria (auto, moto, camion…) per regione NUTS2. Anni 1990–2024.",
    theme: "trasporti",
    geo: "nuts2",
    timeRange: [1990, 2024],
    updated: "2026-03-17",
    columns: [
      { name: "geo", type: "geo", desc: "Codice NUTS2" },
      { name: "geo_label", type: "string", desc: "Nome regione" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "vehicle", type: "string", desc: "Categoria veicolo (TOT_X_TM/CAR/MOTO/…)" },
      { name: "unit", type: "string", desc: "Unità (NR / P_THAB)" },
      { name: "vehicles", type: "number", desc: "Numero veicoli" },
    ],
    defaultFilters: { vehicle: "CAR", unit: "NR" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/TRAN_R_VEHST",
  },

  // === SALUTE ===============================================================
  {
    code: "HLTH_RS_PHYSREG",
    label: "Medici per regione (NUTS2)",
    desc: "Numero di medici attivi per regione NUTS2. Anni 1993–2024.",
    theme: "salute",
    geo: "nuts2",
    timeRange: [1993, 2024],
    updated: "2025-07-15",
    columns: [
      { name: "geo", type: "geo", desc: "Codice NUTS2" },
      { name: "geo_label", type: "string", desc: "Nome regione" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "unit", type: "string", desc: "Unità (NR / P_HTHAB / P_THAB)" },
      { name: "physicians", type: "number", desc: "Numero medici" },
    ],
    defaultFilters: { unit: "P_HTHAB" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/HLTH_RS_PHYSREG",
  },
  {
    code: "TGS00064",
    label: "Posti letto ospedalieri (NUTS2)",
    desc: "Posti letto disponibili negli ospedali per regione NUTS2. Anni 2013–2024.",
    theme: "salute",
    geo: "nuts2",
    timeRange: [2013, 2024],
    updated: "2025-07-15",
    columns: [
      { name: "geo", type: "geo", desc: "Codice NUTS2" },
      { name: "geo_label", type: "string", desc: "Nome regione" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "beds", type: "number", desc: "Posti letto ospedalieri" },
    ],
    defaultFilters: { unit: "P_HTHAB" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/TGS00064",
  },

  // === ISTRUZIONE ===========================================================
  {
    code: "EDUC_UOE_ENRP01",
    label: "Iscritti all'istruzione per livello",
    desc: "Studenti iscritti per livello ISCED, sesso e regime. Livello paese. Anni 2012–2024.",
    theme: "istruzione",
    geo: "paese",
    timeRange: [2012, 2024],
    updated: "2026-06-05",
    columns: [
      { name: "geo", type: "geo", desc: "Codice paese" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "isced11", type: "string", desc: "Livello istruzione (ED0..ED8)" },
      { name: "sex", type: "string", desc: "Sesso (T/M/F)" },
      { name: "sector", type: "string", desc: "Settore (PUB/PRV/TOTAL)" },
      { name: "worktime", type: "string", desc: "Regime (FT/PT/TOTAL)" },
      { name: "enrolment", type: "number", desc: "Numero iscritti" },
    ],
    defaultFilters: { unit: "NR", sex: "T", isced11: "TOTAL", sector: "TOTAL", worktime: "TOTAL" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/EDUC_UOE_ENRP01",
  },

  // === LAVORO — salari ======================================================
  {
    code: "EARN_SES_ANNUAL",
    label: "Salari annui per settore, professione, sesso",
    desc: "Retribuzione lorda annua per settore NACE, professione ISCO-08, età e sesso. Livello paese. Anni 2002–2022.",
    theme: "lavoro",
    geo: "paese",
    timeRange: [2002, 2022],
    updated: "2026-02-09",
    columns: [
      { name: "geo", type: "geo", desc: "Codice paese" },
      { name: "year", type: "year", desc: "Anno" },
      { name: "nace_r2", type: "string", desc: "Settore NACE Rev.2" },
      { name: "isco08", type: "string", desc: "Professione ISCO-08" },
      { name: "sex", type: "string", desc: "Sesso (T/M/F)" },
      { name: "age", type: "string", desc: "Fascia d'età" },
      { name: "worktime", type: "string", desc: "Regime orario (TOTAL/FT/PT)" },
      { name: "indic_se", type: "string", desc: "Indicatore (media, mediana, …)" },
      { name: "value", type: "number", desc: "Retribuzione in EUR" },
    ],
    defaultFilters: { sex: "T", age: "TOTAL", worktime: "TOTAL", indic_se: "MED_E_EUR", nace_r2: "B-S", isco08: "TOTAL" },
    landing: "https://ec.europa.eu/eurostat/databrowser/view/EARN_SES_ANNUAL",
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

export const EUROSTAT_THEMES: Record<EurostatTheme, { label: string; emoji: string }> = {
  demografia: { label: "Popolazione", emoji: "👥" },
  economia: { label: "Economia", emoji: "📊" },
  abitazioni: { label: "Abitazioni", emoji: "🏠" },
  ambiente: { label: "Ambiente", emoji: "🌿" },
  lavoro: { label: "Lavoro", emoji: "💼" },
  turismo: { label: "Turismo", emoji: "✈️" },
  trasporti: { label: "Trasporti", emoji: "🚗" },
  salute: { label: "Salute", emoji: "🏥" },
  istruzione: { label: "Istruzione", emoji: "🎓" },
};

/** Restituisce i dataset curati filtrati per tema (o tutti se non specificato). */
export function curatedByTheme(theme?: EurostatTheme): EurostatDataset[] {
  return theme ? EUROSTAT_DATASETS.filter((d) => d.theme === theme) : EUROSTAT_DATASETS;
}

/** Cerca nei dataset curati per parola chiave (label + desc + code). */
export function searchCurated(query: string): EurostatDataset[] {
  const q = query.toLowerCase().trim();
  if (!q) return EUROSTAT_DATASETS;
  return EUROSTAT_DATASETS.filter(
    (d) =>
      d.label.toLowerCase().includes(q) ||
      d.desc.toLowerCase().includes(q) ||
      d.code.toLowerCase().includes(q) ||
      d.theme.includes(q),
  );
}

/** Label geografica leggibile per la granularità del dataset. */
export function geoLabel(geo: EurostatGeo): string {
  return {
    paese: "Livello paese (UE+)",
    nuts2: "NUTS2 — regioni (tutti i paesi UE)",
    nuts3: "NUTS3 — province (tutti i paesi UE)",
  }[geo];
}
