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
