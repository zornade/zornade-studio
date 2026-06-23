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
| **Bivariata** | aree (2 numeri) | `regioni-completo.csv` | combina due variabili in una matrice 3×3; la 2ª colonna si sceglie nel Design |
| **Spike map** | aree | `regioni-completo.csv` | un picco per regione, altezza = valore |
| **Estrusione 3D** | aree | `regioni-completo.csv` | aree estruse in 3D (la mappa si inclina automaticamente) |

Note:
- Per la **bivariata**: in “Struttura” imposta la *colonna valore* (1ª
  variabile); in “Design” → “Seconda variabile” scegli la 2ª. La legenda 3×3
  compare in basso a sinistra.
- Per **mappa di calore / esagoni** scegli un livello di zoom adatto: la densità
  si legge meglio sull'insieme dell'Italia.
- L'**estrusione 3D** inclina la camera (pitch 50°); trascina con il tasto destro
  per ruotare la vista.
- Tutte queste mappe restano **in editor + export PNG** (come simboli/punti/
  categorie): la pubblicazione embed oggi è solo per la coropletica.
