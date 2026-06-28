# Dataset di esempio — Consumo di suolo (ISPRA)

CSV pronti per testare le mappe coropletiche di Zornade Studio, basati su due
articoli di Altreconomia che usano i dati del Rapporto SNPA/ISPRA sul consumo
di suolo (edizione 2024, dati 2023):

- https://altreconomia.it/il-consumo-di-suolo-in-italia-non-e-ancora-una-priorita/
- https://altreconomia.it/ancora-consumo-di-suolo-meno-ma-sempre-troppo-per-rimanere-nel-futuro/

## Stato dei dati
I valori presenti sono SOLO quelli citati esplicitamente negli articoli (colonna
`fonte`). Le celle vuote vanno completate con le tavole ufficiali ISPRA, che sono
aperte e scaricabili (Excel/CSV per regione, provincia e comune):

- ISPRA — I dati sul consumo di suolo:
  https://www.isprambiente.gov.it/it/attivita/suolo-e-territorio/suolo/il-consumo-di-suolo/i-dati-sul-consumo-di-suolo

Una mappa generata con questi CSV mostrerà colorate solo le aree con valore noto
e in "no data" le altre: è normale finché non si completa dal dataset ISPRA.

## File

| File | Livello | Colonna valore | Join consigliato |
|------|---------|----------------|------------------|
| `consumo-suolo-regioni-2023.csv` | Regione | `consumo_suolo_pct` (% suolo consumato) | `codice_istat` |
| `urbanizzazione-province-2023.csv` | Provincia | `coeff_urbanizzazione_pct` (% area urbanizzata) | `sigla` (targa) |
| `impermeabilizzazione-comuni-2023.csv` | Comune | `suolo_impermeabile_pct` (%) — in alternativa `consumo_suolo_2023_ha` | `comune` + `provincia` |

Note:
- Per i COMUNI il join per nome richiede la provincia (`provincia` = sigla) per
  evitare omonimie; in produzione meglio il codice ISTAT del comune.
- La riga "ITALIA (media nazionale)" nel file regioni è un riferimento: non va
  mappata.
- `consumo_suolo_2023_ha` (ettari consumati nell'anno) è il dato adatto a una
  mappa a SIMBOLI PROPORZIONALI — funzione ancora in sviluppo nello Studio.

---

# Dataset di esempio — Grafici (O3.2)

CSV pronti per testare i **grafici** (barre, linee, aree, dispersione) e la
**tabella** di Zornade Studio. Questi dati sono **illustrativi a scopo
dimostrativo** — valori plausibili ma **non ufficiali**: servono solo a provare
le funzioni, non come fonte.

| File | Grafico consigliato | Assi suggeriti (passo Struttura) |
|------|---------------------|----------------------------------|
| `grafico-barre-rinnovabili-regioni.csv` | **Barre** | X = `regione`, Y = `produzione_rinnovabile_gwh`; prova "Ordina per valore" |
| `grafico-linee-rinnovabili-anni.csv` | **Linee** (multi-serie) | X = `anno`, Y = `produzione_twh`, **Serie = `fonte`** |
| `grafico-aree-emissioni-trasporti.csv` | **Aree** | X = `anno`, Y = `emissioni_co2_trasporti_mt` |
| `grafico-dispersione-pil-occupazione.csv` | **Dispersione** | X = `pil_procapite_keur`, Y = `tasso_occupazione_pct` |
| `grafico-tabella-settori.csv` | **Tabella** | mostra tutte le colonne |

Note:
- I file con `regione` (barre, dispersione) vengono riconosciuti anche come dati
  **geografici**: di default appare una mappa, poi nel passo "Visualizza" scegli
  il grafico. I grafici funzionano su **qualsiasi** dato, mappabile o no.
- I file con solo `anno`/`fonte`/`settore` (linee, aree, tabella) **non** hanno
  una dimensione geografica: si caricano comunque come **tabella** e si
  visualizzano come grafico.
- Per le **linee multi-serie** imposta `Serie = fonte` nel passo Struttura:
  senza, le tre fonti vengono sommate in un'unica linea (totale annuo).
- L'unità di misura (`GWh`, `TWh`, `Mt`, `%`) si imposta nel passo Design e
  appare nel tooltip, come nelle mappe.

---

# Dataset di esempio — Mappe complete (O3.6)

Dataset pensati per provare **ogni tipo di mappa** e il nuovo passo
**“Struttura”** (tra “Dati” e “Visualizza”), dove confermi o correggi come usare
ogni colonna (livello geografico, chiave, coordinate, valore, categoria, tempo).
L'anteprima a destra colora ogni colonna con il suo ruolo. I valori numerici sono
**illustrativi** (plausibili ma non ufficiali): servono a provare le funzioni.

| File | Livello / Tipo | Mappe che abilita | Note |
|------|----------------|-------------------|------|
| `regioni-completo.csv` | Regione (area) | **Coropletica**, **Simboli proporzionali**, **Categorie**, + Barre/Dispersione/Tabella | Il “tuttofare”: 3 colonne numeriche da mappare + `macroarea` per le categorie |
| `regioni-differenziata-temporale.csv` | Regione (area, temporale) | **Coropletica con linea del tempo**, + Linee | Forma lunga `regione, anno, valore` (2018–2023): scrub + play |
| `paesi-europa.csv` | Paese (area, mondo) | **Coropletica**, **Categorie** | Join su `codice_iso` (ISO-A3); `gruppo` per la mappa a categorie |
| `citta-italiane-punti.csv` | Punti (lat/lon) | **Punti**, **Localizzatore** | `categoria` colora i punti; `popolazione` li dimensiona; `citta` è l'etichetta |

Come usarli, passo per passo:
1. **Dati** → carica il file.
2. **Struttura** → controlla i badge di ruolo. Per `regioni-completo.csv`:
   `regione` = geografia, `macroarea` = categoria, gli altri = valore/numero.
   Per `citta-italiane-punti.csv`, se serve, imposta `lat`/`lon` come coordinate
   e `citta` come etichetta.
3. **Visualizza** → si accendono solo le mappe compatibili con i dati: scegli.
4. **Design** → personalizza colore, classi, etichette del valore (la **colonna**
   del dato si sceglie in “Struttura”, non qui).

Dettaglio per tipo di mappa:
- **Coropletica** — `regioni-completo.csv` (scegli quale colonna numerica nel
  passo Struttura), `paesi-europa.csv`, o i file consumo-suolo qui sopra.
- **Simboli proporzionali** — `regioni-completo.csv`: bolle dimensionate al
  valore sui centroidi regionali.
- **Categorie** — `regioni-completo.csv` (`macroarea`) o `paesi-europa.csv`
  (`gruppo`): un colore per categoria.
- **Punti** e **Localizzatore** — `citta-italiane-punti.csv`: il Localizzatore
  aggiunge le etichette sempre visibili (dal nome città).
- **Linea del tempo** — `regioni-differenziata-temporale.csv`: lo slider scorre
  i semestri/anni con la scala colore condivisa.

Tutti i nomi/codici geografici di questi file sono stati verificati: combaciano
al 100% con le geometrie incluse (20/20 regioni, 23/23 paesi).

---

# Dataset verificati per la landing page

Dataset con dati reali da fonti ufficiali — adatti a produrre mappe visivamente
forti da usare come demo su zornade.com/studio.

| File | Livello | Fonte | Storia visiva |
|------|---------|-------|---------------|
| `province-reddito-irpef-2022.csv` | Provincia (107) | MEF — Dichiarazioni dei redditi, anno d'imposta 2021 | Gradiente nord-sud molto marcato (€12.9k–€28.4k). Mappa coropletica per provincia, palette sequenziale. |
| `europa-pil-pps-2022.csv` | Paese europeo (40) | Eurostat — `nama_10_pc`, 2022 (EU27=100) | Forte divario est-ovest e outlier Lussemburgo (256) e Irlanda (208). Mappa coropletica europea. |
| `mondo-aspettativa-vita-2023.csv` | Paese mondiale (107) | WHO/World Bank — Global Health Observatory 2023 | Contrasto netto Africa sub-sahariana (53–68 anni) vs Asia orientale/Europa (81–84). Mappa mondiale. |

Queste mappe si creano in Studio caricando il CSV e usando il join automatico
su `sigla` (province), `codice_iso` ISO-A3 (paesi). La classificazione e la
palette si impostano nel passo Design.

---

# Dataset di esempio — Mappe tematiche avanzate (O4.x)

Sei nuove mappe tematiche, tutte native (nessun plugin esterno). Le mappe a
**punti** danno il meglio con tanti punti: usa `eventi-punti-italia.csv` (487
eventi raggruppati attorno alle città). Le mappe ad **aree** usano
`regioni-completo.csv` (che ha due colonne numeriche, indispensabili per la
bivariata).

| Mappa | Dati | File | Note |
|-------|------|------|------|
| **Mappa di calore** | punti | `eventi-punti-italia.csv` | densità; `intensita` pesa i punti (scegli `intensita` come valore in Struttura) |
| **Densità di punti** | punti | `eventi-punti-italia.csv` | un puntino per evento; `categoria` li colora |
| **Esagoni** | punti | `eventi-punti-italia.csv` | griglia esagonale, colore per conteggio |
| **Bivariata** | aree (2 numeri) | `mondo-clima-emissioni-vulnerabilita.csv` · `regioni-completo.csv` | combina due variabili in una matrice 3×3; la 2ª colonna si sceglie in “Struttura” → “Secondo valore” |
| **Spike map** | aree | `regioni-completo.csv` | un picco per regione, altezza = valore |
| **Estrusione 3D** | aree | `regioni-completo.csv` | aree estruse in 3D (la mappa si inclina automaticamente) |

Note:
- Per la **bivariata**: in “Struttura” imposta la *colonna valore* (1ª
  variabile) e il *Secondo valore* (2ª variabile). La legenda 3×3 compare in
  basso a sinistra. Esempio mondiale pronto: `mondo-clima-emissioni-vulnerabilita.csv`
  (livello **Paesi**, chiave `codice_iso`) — **CO₂ pro capite 2023** (Our World in
  Data / Global Carbon Project, CC-BY) × **vulnerabilità climatica 2023** (ND-GAIN,
  University of Notre Dame): mette in mappa la “giustizia climatica” (chi emette
  vs. chi subisce). 187 Paesi.
- Per **mappa di calore / esagoni** scegli un livello di zoom adatto: la densità
  si legge meglio sull'insieme dell'Italia.
- L'**estrusione 3D** inclina la camera (pitch 50°); trascina con il tasto destro
  per ruotare la vista.
- Tutte queste mappe restano **in editor + export PNG** (come simboli/punti/
  categorie): la pubblicazione embed oggi è solo per la coropletica.

---

# 10 mappe reali per la landing — set verificato

Dieci dataset con **dati reali da fonti ufficiali** (World Bank, Eurostat),
pronti per pubblicare dieci coropletiche da usare nel carosello della landing
di Studio. Tutte sono **mappe ad aree (coropletiche)** sui quattro livelli
geografici supportati dall'embed, quindi **pubblicabili** così come sono.

Tutte le chiavi geografiche sono state verificate contro le geometrie incluse:
**paesi** join su `codice_iso` (ISO-A3), **regioni** su `regione` (nome esatto),
**province** su `sigla` (targa). Copertura: regioni 20/20, province 107/107.

## Mondo ed Europa (livello `paesi`)

| File | Fonte esatta | Colonna valore | Titolo / sottotitolo suggerito | Storia per chi scrive |
|------|--------------|----------------|--------------------------------|-----------------------|
| `mondo-pil-procapite-ppp-2023.csv` | World Bank, indicatore `NY.GDP.PCAP.PP.CD`, 2023 (161 paesi) | `pil_procapite_ppp_usd` | *Ricchezza del mondo* — PIL pro capite a parità di potere d'acquisto, 2023 | Outlier estremi (Lussemburgo, Irlanda, Qatar > 129.000 $) contro l'Africa sub-sahariana: il colpo d'occhio del divario globale. |
| `mondo-aspettativa-vita-2023-full.csv` | World Bank, indicatore `SP.DYN.LE00.IN`, 2023 (169 paesi) | `aspettativa_vita_anni` | *Quanto si vive* — aspettativa di vita alla nascita, 2023 | Contrasto netto tra Europa/Asia orientale (81–84 anni) e Africa centrale (53–62): mappa mondiale ad alto impatto. |
| `europa-rinnovabili-2023.csv` | Eurostat, `nrg_ind_ren` (`nrg_bal=REN`, `unit=PC`), 2023 (36 paesi) | `rinnovabili_pct` | *L'Europa delle rinnovabili* — quota di energia da fonti rinnovabili, 2023 | Islanda, Norvegia e Svezia oltre il 60%; Italia e grandi economie continentali molto sotto: la geografia della transizione. |
| `europa-disoccupazione-giovanile-2023.csv` | Eurostat, `une_rt_a` (`sex=T`, `age=Y15-24`, `unit=PC_ACT`), 2023 (33 paesi) | `disoccupazione_giovanile_pct` | *Giovani senza lavoro* — tasso di disoccupazione 15–24 anni, 2023 | Il Sud Europa (Spagna, Italia, Grecia) contro Germania e Paesi Bassi: una frattura generazionale che si vede sulla mappa. |

## Italia per regione (livello `regioni`)

| File | Fonte esatta | Colonna valore | Titolo / sottotitolo suggerito | Storia per chi scrive |
|------|--------------|----------------|--------------------------------|-----------------------|
| `regioni-reddito-famiglie-2022.csv` | Eurostat, `nama_10r_2hhinc` (`direct=BAL`, `na_item=B6N`, `unit=PPS_EU27_2020_HAB`), 2022 | `reddito_disponibile_pps` | *Il reddito delle famiglie* — reddito disponibile pro capite (PPS), 2022 | Trentino-Alto Adige e Lombardia in testa (~24.500–24.850), Campania e Calabria in coda (~14.800): il divario Nord-Sud in una scala. |
| `regioni-speranza-vita-2022.csv` | Eurostat, `demo_r_mlifexp` (`sex=T`, `age=Y_LT1`), 2022 | `speranza_vita_anni` | *Dove si vive più a lungo* — speranza di vita alla nascita, 2022 | Trentino-Alto Adige e Veneto sopra gli 83,5 anni; Campania ultima a 81,1: salute e territorio. |
| `regioni-occupazione-2023.csv` | Eurostat, `lfst_r_lfe2emprt` (`sex=T`, `age=Y20-64`, `unit=PC`), 2023 | `tasso_occupazione_pct` | *Chi lavora in Italia* — tasso di occupazione 20–64 anni, 2023 | Il Mezzogiorno con i tassi più bassi d'Europa: una mappa che spiega un problema strutturale. |

## Italia per provincia (livello `province`)

| File | Fonte esatta | Colonna valore | Titolo / sottotitolo suggerito | Storia per chi scrive |
|------|--------------|----------------|--------------------------------|-----------------------|
| `province-pil-procapite-2022.csv` | Eurostat, `nama_10r_3gdp` (`unit=EUR_HAB`), 2022 (107/107) | `pil_procapite_eur` | *La ricchezza provincia per provincia* — PIL pro capite in euro, 2022 | Dal cuore produttivo del Nord alle province del Sud: il dettaglio provinciale rende il divario più granulare e leggibile. |
| `province-eta-mediana-2023.csv` | Eurostat, `demo_r_pjanind3` (`indic_de=MEDAGEPOP`), 2023 (107/107) | `eta_mediana_anni` | *L'Italia che invecchia* — età mediana della popolazione, 2023 | Savona, Biella e Oristano oltre i 52 anni; Napoli e Caserta le più giovani (~44): la demografia che cambia il Paese. |
| `province-densita-popolazione-2022.csv` | Eurostat, `demo_r_d3dens` 2022 (102 province) + 5 province sarde calcolate (vedi nota) (107/107) | `densita_ab_kmq` | *Dove vivono gli italiani* — densità di popolazione (ab./km²), 2022 | Napoli e Monza-Brianza oltre 2.000 ab./km² contro le province interne sotto i 40: il vuoto e il pieno del territorio. |

## Note di provenienza (essere precisi)

- **Regioni e dati Eurostat regionali**: i livelli NUTS2 di Eurostat dividono il
  Trentino-Alto Adige in due (Bolzano e Trento). Nei file `regioni-*` i due
  valori sono stati **combinati come media** nella riga
  `Trentino-Alto Adige/Südtirol`, coerente con la geometria a 20 regioni dello
  Studio (Bolzano ~534k e Trento ~542k abitanti, quindi la media è quasi
  equivalente a una media ponderata).
- **Densità province**: i 102 valori provengono direttamente da Eurostat
  `demo_r_d3dens` (2022). Le **5 province sarde** (Sassari, Nuoro, Cagliari,
  Oristano, Sud Sardegna) non sono presenti in quel dataset con i codici NUTS3
  attuali (riorganizzazione del 2016): sono state **calcolate** come
  popolazione residente Eurostat 2023 (`demo_r_pjanaggr3`) divisa per la
  superficie del confine provinciale ufficiale ISTAT (area geodetica del
  poligono incluso nello Studio). I valori risultanti combaciano con le cifre
  ISTAT note (es. Cagliari ~337 ab./km², Nuoro ~35 ab./km²).
- **Nomi esatti delle regioni**: i due nomi bilingui sono scritti come nelle
  geometrie — `Trentino-Alto Adige/Südtirol` e `Valle d'Aosta/Vallée d'Aoste` —
  per garantire il join automatico per nome.
- **Aggregati esclusi**: nei file mondiali ed europei sono stati rimossi gli
  aggregati (UE27, area euro, raggruppamenti World Bank), così la mappa mostra
  solo singoli paesi.

Come pubblicarli per la landing:
1. **Dati** → carica il CSV. **Struttura** → conferma livello e chiave.
2. **Visualizza** → **Coropletica**. **Design** → palette sequenziale, classi
   (quantili o intervalli naturali), unità nel tooltip, titolo e fonte.
3. **Pubblica** → ottieni l'URL embed `studio.zornade.com/embed/{slug}/{hash}/`
   da inserire nel carosello della landing.
