/**
 * Golden-file corpus for the ingestion + profiling + geo-resolution + viz
 * compatibility pipeline (ROADMAP §1.13). Each case is a realistic, often
 * "dirty" dataset as produced by Italian PA / Excel exports, with the expected
 * outcome encoded so the tests are deterministic and self-documenting.
 *
 * Keep raw strings verbatim (including \r\n where relevant) - the point is to
 * exercise the real parser, not a cleaned-up version.
 */

import type { GeoLevel } from "../choropleth";
import type { SemanticType } from "../profile";

export interface DatasetCase {
  /** Short description. */
  name: string;
  /** Raw file content as the parser receives it. */
  raw: string;
  /** Expected detected delimiter (parser is internal; checked via column count). */
  expectColumns: number;
  /** Expected geo level resolved by VALUE, or null if non-geographic. */
  expectLevel: GeoLevel | null;
  /** Expected geo key column when expectLevel != null. */
  expectKeyColumn?: string;
  /** Column → expected semantic type assertions (subset; not every column). */
  expectTypes?: Record<string, SemanticType>;
  /** Viz ids expected to be DATA-compatible. */
  expectVizCompatible?: string[];
  /** Viz ids expected to be DATA-incompatible. */
  expectVizIncompatible?: string[];
  /** Expected minimum join match fraction when expectLevel != null (0..1). */
  expectMinJoinFrac?: number;
}

export const DATASET_CASES: DatasetCase[] = [
  // 1. Regioni per NOME, ; + CRLF + colonna vuota finale (il bug "tutto grigio").
  {
    name: "regioni per nome (; CRLF, col vuota finale)",
    raw:
      '"Regione";"Arrivi";\r\n"Lombardia";"25794";\r\n"Veneto";"73890";\r\n' +
      '"Lazio";"3421";\r\n"Sicilia";"1333";\r\n"Valle d\'Aosta";"107";\r\n',
    expectColumns: 3,
    expectLevel: "regioni",
    expectKeyColumn: "Regione",
    expectVizCompatible: ["choropleth", "table"],
    expectVizIncompatible: ["points", "scatter"],
    expectMinJoinFrac: 0.9,
  },
  // 2. Regioni per CODICE ISTAT (zero-pad).
  {
    name: "regioni per codice ISTAT",
    raw: "cod_reg,valore\n01,10\n03,20\n12,30\n19,40\n20,50\n",
    expectColumns: 2,
    expectLevel: "regioni",
    expectKeyColumn: "cod_reg",
    expectMinJoinFrac: 0.9,
  },
  // 3. Province per SIGLA.
  {
    name: "province per sigla",
    raw: "sigla,disoccupazione\nMI,5.1\nRM,7.3\nNA,18.2\nTO,6.4\nBZ,2.1\n",
    expectColumns: 2,
    expectLevel: "province",
    expectKeyColumn: "sigla",
    expectMinJoinFrac: 0.9,
  },
  // 4. Province per NOME (incl. bilingue).
  {
    name: "province per nome",
    raw: "provincia;abitanti\nMilano;3200000\nRoma;4300000\nBolzano/Bozen;530000\nForlì-Cesena;395000\n",
    expectColumns: 2,
    expectLevel: "province",
    expectKeyColumn: "provincia",
    expectMinJoinFrac: 0.9,
  },
  // 5. Comuni per CODICE ISTAT (6 cifre).
  {
    name: "comuni per codice ISTAT",
    raw: "com_istat_code,popolazione\n058091,2750000\n015146,1370000\n072006,990000\n",
    expectColumns: 2,
    expectLevel: "comuni",
    expectKeyColumn: "com_istat_code",
    expectMinJoinFrac: 0.9,
  },
  // 6. Comuni per NOME.
  {
    name: "comuni per nome",
    raw: "comune,reddito\nRoma,25000\nMilano,32000\nNapoli,18000\nAgliè,21000\n",
    expectColumns: 2,
    expectLevel: "comuni",
    expectKeyColumn: "comune",
    expectMinJoinFrac: 0.75,
  },
  // 7. Paesi per NOME ITALIANO.
  {
    name: "paesi per nome italiano",
    raw: "paese,pil\nItalia,2100\nFrancia,2900\nGermania,4200\nSpagna,1400\n",
    expectColumns: 2,
    expectLevel: "paesi",
    expectKeyColumn: "paese",
    expectMinJoinFrac: 0.9,
  },
  // 8. Paesi per ISO-A3.
  {
    name: "paesi per ISO-A3",
    raw: "iso_a3;valore\nITA;1\nFRA;2\nDEU;3\nUSA;4\nCHN;5\n",
    expectColumns: 2,
    expectLevel: "paesi",
    expectKeyColumn: "iso_a3",
    expectMinJoinFrac: 0.9,
  },
  // 9. Paesi per ISO-A2.
  {
    name: "paesi per ISO-A2",
    raw: "iso,valore\nIT,1\nFR,2\nDE,3\nES,4\n",
    expectColumns: 2,
    expectLevel: "paesi",
    expectKeyColumn: "iso",
    expectMinJoinFrac: 0.9,
  },
  // 10. ACI misto comune+provincia (il caso reale).
  {
    name: "ACI radiazioni (misto comune/provincia)",
    raw:
      "tipoEnteTerritoriale,enteTerritoriale,provincia,demolizioni\n" +
      "Comune,Agrigento,Agrigento,1049\nComune,Aragona,Agrigento,120\n" +
      "Comune,Milano,Milano,8000\nComune,Roma,Roma,9000\nProvincia,Latina,,278\n",
    expectColumns: 4,
    expectLevel: "comuni",
    expectKeyColumn: "enteTerritoriale",
    expectVizCompatible: ["choropleth", "table"],
  },
  // 11. Punti lat/lon (nessuna area). Nomi NON geografici per testare i punti puri.
  {
    name: "punti lat/lon",
    raw: "nome,lat,lon\nStazione 1,41.9,12.5\nStazione 2,45.46,9.19\nStazione 3,40.85,14.27\n",
    expectColumns: 3,
    expectLevel: null,
    expectTypes: { lat: "geo-point-lat", lon: "geo-point-lon" },
    expectVizCompatible: ["points", "heatmap", "table"],
    expectVizIncompatible: ["choropleth"],
  },
  // 12. TSV (tab) con numeri IT.
  {
    name: "TSV con numeri IT",
    raw: "Regione\tValore\nLombardia\t1.234,56\nVeneto\t987,10\nLazio\t2.000\n",
    expectColumns: 2,
    expectLevel: "regioni",
    expectKeyColumn: "Regione",
  },
  // 13. Pipe-separated.
  {
    name: "pipe-separated",
    raw: "regione|tasso\nPiemonte|12,3\nToscana|9,8\nPuglia|15,1\n",
    expectColumns: 2,
    expectLevel: "regioni",
    expectKeyColumn: "regione",
  },
  // 14. Numeri con valuta, %, e token nullo.
  {
    name: "valuta percentuali e token nullo",
    raw: "comune,prezzo,quota\nRoma,€ 1.500,12%\nMilano,€ 2.300,18%\nNapoli,n.d.,n.d.\n",
    expectColumns: 3,
    expectLevel: "comuni",
    expectKeyColumn: "comune",
  },
  // 15. Formato WIDE (una colonna per anno).
  {
    name: "wide: colonne per anno",
    raw: "regione,2019,2020,2021\nLombardia,100,90,110\nLazio,80,70,95\n",
    expectColumns: 4,
    expectLevel: "regioni",
    expectKeyColumn: "regione",
  },
  // 16. Non geografico: categoria + valore → bar/pie.
  {
    name: "categorico + valore (no geo)",
    raw: "settore,occupati\nAgricoltura,900\nIndustria,4500\nServizi,16000\n",
    expectColumns: 2,
    expectLevel: null,
    expectVizCompatible: ["bar", "pie", "table"],
    expectVizIncompatible: ["choropleth", "points"],
  },
  // 17. Temporale (anno) + valore → grafici temporali.
  {
    name: "serie temporale per anno",
    raw: "anno,prezzo\n2015,1000\n2016,1100\n2017,1200\n2018,1300\n",
    expectColumns: 2,
    expectLevel: null,
    expectVizCompatible: ["line", "calendar", "barrace", "table"],
  },
  // 18. Due numeriche → scatter.
  {
    name: "due numeriche (scatter)",
    raw: "x,y\n1.5,2.3\n4.1,5.0\n2.2,8.8\n9.0,1.1\n",
    expectColumns: 2,
    expectLevel: null,
    expectVizCompatible: ["scatter", "bubble", "table"],
    expectVizIncompatible: ["choropleth"],
  },
  // 19. Righe vuote in mezzo (tollerate dal parser; lo strip delle note a piè
  // di tabella è una pulizia ancora futura, §1.12.3).
  {
    name: "righe vuote tollerate",
    raw: "regione,valore\nLombardia,10\n\nVeneto,20\nLazio,30\n",
    expectColumns: 2,
    expectLevel: "regioni",
    expectKeyColumn: "regione",
  },
  // 20. BOM + accenti: Forlì e Cesenatico SONO comuni reali → risolve a comuni
  // (verifica la decodifica BOM/accenti lungo tutta la pipeline).
  {
    name: "BOM + accenti (comuni reali)",
    raw: "\uFEFFcomune,valore\nForlì,10\nCesenatico,20\nRimini,30\n",
    expectColumns: 2,
    expectLevel: "comuni",
    expectKeyColumn: "comune",
    expectMinJoinFrac: 0.9,
  },
];
