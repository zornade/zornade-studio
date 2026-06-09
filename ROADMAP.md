# Zornade Studio — Roadmap funzionalità completa

> Obiettivo: alternativa interna a Datawrapper/Flourish/Infogram/Felt, ma con il **moat Zornade**
> (geodati italiani + query OSM + query DB Zornade). Si sviluppano **prima le funzionalità più
> facili**, ma la roadmap qui sotto copre **tutto** ciò che offrono i competitor.
>
> Aggiornato: 2026-06-09.

---

## 0 · Inventario dati Zornade (il vantaggio competitivo)

Dallo schema PostGIS/Supabase reale. Tutto interrogabile in sola lettura (credenziali generate a mano).

| Tema | Tabelle | Esempi di mappa editoriale |
|---|---|---|
| **Confini amministrativi** | `regions`, `provinces`, `comuni`, `cap_subcomunali` (9.228 zone CAP), `census_sections_final_postcodes` | Basi per coropletiche per regione/provincia/comune/CAP |
| **Prezzi immobiliari OMI** | `omi_historical` (2015→2025, semestrale), `omi_zones_geom_historical`, `parcel_omi`, `parcel_omi_history` | Prezzo €/m² per zona, variazioni nel tempo |
| **Rischio territoriale** | `parcel_risk` (sismico, alluvione ISPRA, frana IFFI, subsidenza) | Mappe di rischio per area |
| **Potenziale solare** | `building_solar`, `parcel_solar` (kWp, kWh/anno, payback, LCOE, idoneità) | Tetti idonei al fotovoltaico |
| **Indicatori socio-demografici** | `buildings` (età media, densità abitativa, tassi occupazione/istruzione/stranieri, indici coesione/resilienza) | Mappe demografiche per sezione/comune |
| **Catasto** | `parcels`, `catasto_fogli`, `visure`, `visura_immobili`, `visura_intestati` | Particelle, fogli |
| **Indirizzi & POI** | `addresses` (ANNCSU), `fsq_places`, `places`, `real_estate` | Geocoding, punti di interesse |
| **Terreno** | `parcel_terrain` (quota, ruggedness, DEM TINItaly) | Altimetria |

---

## 1 · Catalogo funzionalità competitor (da coprire)

### 1.1 Tipi di mappa
- Coropletica (aree colorate per valore)
- Coropletica bivariata (due variabili insieme)
- Simboli proporzionali (bolle dimensionate)
- Punti / dot density
- Categorie (colore per categoria)
- Localizzatore (mappa con pin + contesto)
- Mappa di calore (heatmap/KDE)
- Esagoni / griglia (hexbin)
- Flussi / connessioni (origine→destinazione)
- Estrusione 3D / globe
- Spike map, cartogramma
- Inset / minimappa per isole e zone (es. isole italiane)
- Elementi locator: scale bar, freccia nord, marker con icone custom
- Proiezioni cartografiche selezionabili
- Layer raster / satellite / tile esterni (WMS/WMTS, GeoTIFF) + image overlay georeferenziato

### 1.2 Tipi di grafico
- Barre / colonne (raggruppate, impilate, 100%)
- Linee, aree (anche streamgraph)
- Dispersione (scatter), bolle
- Torta / ciambella
- Range / dumbbell / arrow plot
- Istogramma, box plot
- Tabella (con sparkline, heatmap di cella, ricerca)
- Sankey, chord, treemap, gerarchie, circle pack, network
- Radar, gauge, marimekko, parliament, slope, dumbbell
- Calendar heatmap, beeswarm, ridgeline, word cloud, gantt
- Bar chart race (animazione)
- Cards / slideshow di immagini
- **Tabella avanzata** come output: ricerca, paginazione, sparkline, barre/heatmap di cella, colonne immagine/link/markdown

### 1.3 Storytelling & interazione
- **Scrollytelling** (passi narrativi con transizioni di camera/dati)
- Animazioni e transizioni tra stati
- Tab / viste multiple, slide
- Tooltip al passaggio + **tooltip HTML personalizzati**
- Legende cliccabili/filtranti
- Annotazioni narrative ancorate ai passi
- **Controlli per il lettore**: dropdown, slider, bottoni, ricerca/geocoder
- **Time slider / animazione temporale** con play (es. prezzi OMI 2015→2025)
- Filtri lato lettore + click su feature → dettaglio / link
- (Opzionale, Flourish) narrazione audio sincronizzata ai passi

### 1.4 Annotazioni custom
- Testo, titoli, frecce, linee, evidenziazioni
- Forme (rettangolo/cerchio), callout
- Marker/pin custom, etichette dirette
- Range/bande di evidenziazione su assi
- Annotazioni con immagini + linee di connessione a una feature
- **Disegno diretto sulla mappa come dati** (stile Felt): pin, linee, poligoni, percorsi, freehand

### 1.5 Sorgenti dati
- Upload CSV / Excel / GeoJSON / Shapefile / KML-KMZ / GeoTIFF (raster)
- Incolla da foglio di calcolo
- URL live (Google Sheets / CSV remoto), auto-refresh
- API / JSON + connettori open data (ISTAT, Socrata/CKAN, portali regionali)
- Tile/WMS esterni come layer di sfondo
- **Query OSM (Overpass)** — vedi §2
- **Query DB Zornade (sola lettura)** — vedi §3
- Geo-join automatico su CAP / comune / provincia / regione
- **Trasformazioni dati**: unione di più dataset (join), colonne calcolate, filtri righe, pulizia

### 1.6 Tema & branding
- Colori brand, **font della redazione**, logo (anche sulla mappa)
- Scale colore (sequenziale/divergente/categoriche), daltonismo-safe
- Legenda, formattazione numeri/percentuali/valute/date in italiano
- Flavor basemap (già fatto: positron/carta/ardesia/inchiostro)
- Brand kit riusabile per redazione + temi salvabili / CSS custom
- Proiezione cartografica e localizzazione / output multilingua

### 1.7 Pubblicazione & export
- Embed responsive (iframe + resizer no-GPL) + varianti mobile dedicate
- Snapshot statico immutabile su R2/CDN ("funziona per sempre")
- oEmbed (WordPress)
- Export PNG / SVG / PDF + grafica social / poster / alta risoluzione per stampa
- Export animazione GIF / MP4
- Accessibilità (alt text, contrasto, check daltonismo) + **tabella dati scaricabile / accessibile (screen reader)**
- Analytics di engagement sull'embed (visualizzazioni / interazioni)

### 1.8 Gestione progetti
- Salva / carica / duplica / versiona
- Template riusabili
- Cartelle, ricerca, anteprime
- Collaborazione multi-utente, commenti, permessi, analytics progetto
  (DE-PRIORITIZZATI: modello attuale a operatore singolo)

### 1.9 Codifica dati, classi e legende
- **Metodi di classificazione** (coropletica): quantile, natural breaks (Jenks),
  intervalli uguali, soglie manuali
- Scale colore sequenziali/divergenti/categoriche, palette salvabili, editor gradiente
- Scale di dimensione (bolle); legende a gradini / continua / categorica / di dimensione
- Gestione valori mancanti + colore "nessun dato"
- Numero di classi configurabile + arrotondamenti "belli"

### 1.10 Output oltre l'embed (Infogram-style)
- Infografiche, dashboard multi-pannello, report, slide / presentazioni
- Grafiche per social e poster
- (Opzionale) libreria icone / immagini / sticker

> **Deliberatamente fuori dalla v1** (riconsiderare in futuro): collaborazione real-time
> multi-utente, quiz/sondaggi, narrazione audio (talkies). Non servono all'operatore singolo.

---

## 2 · Funzionalità Zornade · Query OSM (Overpass)

Trovare **punti/oggetti in tutta Italia o in una città**: porti, telecamere di sorveglianza,
scuole, ospedali, fontane, parcheggi, colonnine ricarica, ecc.

- Selettore guidato "Cosa cerchi?" → tag Overpass curati (es. `man_made=surveillance`,
  `harbour=yes`, `amenity=school|hospital`, `amenity=charging_station`).
- Ambito: tutta Italia, regione/provincia/comune, oppure bbox disegnato.
- Risultato → layer di punti GeoJSON sovrapposto alla basemap, con conteggio e tooltip.
- Tecnica: chiamata client-side a un endpoint Overpass; cache dei risultati; rispetto rate limit.

## 3 · Funzionalità Zornade · Query DB Zornade (sola lettura)

L'utente incolla **host / utente / password** (credenziali read-only generate a mano).

- **Proxy server-side obbligatorio** (Supabase Edge Function o micro-API): Postgres non è
  interrogabile dal browser e le credenziali non devono mai stare nel client/bundle.
- Query **guidate** sui dataset noti (OMI, rischio, solare, demografia, CAP…), con aggregazione
  per comune/provincia/CAP → risultato pronto per coropletica.
- Modalità avanzata: SQL read-only con whitelist (solo `SELECT`, timeout, `LIMIT`, ruolo read-only).
- Sicurezza: connessione TLS, nessuna scrittura, audit, credenziali mai persistite nel frontend.

---

## 4 · Roadmap a ondate (prima il più facile)

### Onda 1 — Fondamenta (in corso)
1. ✅ Basemap PMTiles + sistema flavor + tinta brand
2. ✅ Shell frontend (stepper Dati→Visualizza→Design→Pubblica, UX pulita, font Zornade)
3. Coropletica da CSV con geo-join client-side (CAP/comune/provincia) + tooltip,
   con **metodi di classificazione** (quantile/Jenks/intervalli/manuali), legenda a gradini e gestione no-data
4. Titolo/sottotitolo/nota fonte + formattazione numeri IT
5. Embed iframe statico + export PNG

### Onda 2 — Dati & punti
6. Layer di **punti** da CSV/GeoJSON (simboli, categorie)
7. **Query OSM (Overpass)** con selettore guidato
8. Mappa simboli proporzionali + mappa categorie
9. Scale colore avanzate (palette/editor) + check daltonismo
10. Controlli per il lettore (dropdown, ricerca/geocoder, filtri) + tooltip HTML custom
11. Salvataggio progetti (locale → poi DB)

### Onda 3 — DB Zornade & grafici
12. **Proxy query DB Zornade** (read-only) + dataset guidati (OMI, rischio, solare, demografia)
13. Grafici base (barre, linee, aree, scatter) + **tabella ricca** via Observable Plot/Vega-Lite
14. **Time slider / animazione temporale** (OMI storico 2015→2025)
15. Annotazioni custom (testo, frecce, evidenziazioni, marker) + disegno sulla mappa
16. Tabella dati scaricabile / accessibile + export SVG/PDF + oEmbed WordPress

### Onda 4 — Storytelling & avanzate
17. **Scrollytelling** (passi + transizioni camera/dati)
18. Heatmap, hexbin, flussi, estrusione 3D + layer raster/satellite/WMS/GeoTIFF
19. Inset/minimappa isole + scale bar + freccia nord + proiezioni
20. Grafici avanzati (sankey, chord, treemap, bar chart race, radar, calendar heatmap)
21. Dashboard / report / slide + grafiche social / poster + export GIF/MP4
22. Tab/viste multiple, legende filtranti, URL live auto-refresh, localizzazione multilingua
23. Brand kit per redazione + libreria template + CSS/temi custom

### Onda 5 — Packaging
24. Versioning/snapshot immutabili, gestione progetti completa
25. Connettori open data (ISTAT/Socrata/CKAN) + trasformazioni dati (join/colonne calcolate/filtri)
26. Analytics di engagement sugli embed
27. Accessibilità completa, performance, code-splitting
28. (Eventuale) collaborazione multi-utente + layer multi-tenant → SaaS self-serve / rilascio open-core
