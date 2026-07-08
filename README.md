# Zornade Studio

[![Licenza](https://img.shields.io/badge/Licenza-AGPL%20v3-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF.svg)](https://vitejs.dev/)

Editor visuale per costruire mappe e visualizzazioni dati editoriali (coroplete, punti, cartogrammi, flussi, bivariate, serie temporali...) e pubblicarle come embed responsive, senza scrivere codice. Pensato per redazioni, data journalist e chiunque debba raccontare un dataset geografico o statistico in poche ore.

**iscriviti alla newsletter**:

[![Newsletter](https://img.shields.io/badge/Newsletter-Iscriviti-orange?style=for-the-badge&logo=substack)](https://newsletter.zornade.com)

---

## Indice

- [Panoramica](#panoramica)
- [Architettura](#architettura)
- [Prerequisiti](#prerequisiti)
- [Avvio rapido](#avvio-rapido)
- [Configurazione](#configurazione)
- [Funzionalità principali](#funzionalità-principali)
- [Progetti su cloud e condivisione](#progetti-su-cloud-e-condivisione)
- [Sviluppo e contribuzione](#sviluppo-e-contribuzione)
- [Autore](#autore)
- [Licenza](#licenza)

---

## Panoramica

Zornade Studio è un editor "step-by-step" (dati → struttura → visualizzazione → design → pubblicazione) che trasforma un CSV, un file geografico o una query API in una mappa o un grafico pronto per essere incorporato in un articolo, con attribuzione dati corretta e stile personalizzabile.

### Sorgenti dati supportate

- Upload di file (CSV, GeoJSON, Shapefile zippato, KML/KMZ, Excel)
- Incolla di dati tabellari
- URL remoto (CSV/GeoJSON pubblico)
- Overpass API (OpenStreetMap) con geocoding via Nominatim per delimitare l'area
- Catalogo dataset ISTAT/Zornade DB precaricati
- Eurostat (dataset statistici europei)

### Tipi di visualizzazione

Coroplete, punti/marker, bivariate, cartogrammi (contiguo/non contiguo), hexbin, heatmap, flussi (origine-destinazione), grafici (barre, linee, scatter - via Observable Plot), tabelle, serie temporali con time-slider, scrollytelling (racconto a tappe con camera animata), globo 3D.

### Pubblicazione

Ogni mappa pubblicata genera un embed HTML statico (`<iframe>`) ospitato su object storage (S3-compatibile), con didascalia e attribuzione dati obbligatoria (OpenStreetMap/ODbL) incorporata e non rimovibile - vedi [NOTICE](NOTICE).

---

## Architettura

```
Browser (React SPA, Vite)
     │
     ├── MapLibre GL (rendering mappa, stile derivato da PMTiles)
     ├── Observable Plot (grafici non geografici)
     └── Editor state (StudioContext) ── autosave locale (localStorage)
              │
              ├── File locale (.zornade.json) ── salva/apri manuale, offline
              │
              └── Supabase (progetto dedicato, opzionale) ─────────────┐
                     │                                                  │
                     ├── Auth per-utente (magic link email)             │
                     ├── studio_projects (stato editor salvato)         │
                     └── studio_project_collaborators (condivisione)    │
                                                                         │
Netlify Functions (server-side)                                        │
     ├── Gate legacy condiviso (password unica, cookie firmato)         │
     └── Pubblicazione embed → object storage S3-compatibile ◄─────────┘
              │
      Edge Function Supabase: invio email di invito (Resend)
```

Due percorsi di persistenza dei progetti coesistono ed sono entrambi supportati:

| Percorso | Quando usarlo |
|----------|---------------|
| **File locale** (`.zornade.json`, pulsante "Salva progetto") | Sempre disponibile, nessuna configurazione, ideale per backup/portabilità o self-hosting senza Supabase |
| **Cloud (progetto Supabase dedicato)** | Richiede configurazione (vedi sotto); abilita login per-utente, apertura da qualunque dispositivo e condivisione con collaboratori (ruoli editor/visualizzatore) |

### Due livelli di autenticazione, indipendenti

1. **Supabase (magic link email)**: l'unico meccanismo attivo di default, incluso sul deploy ufficiale zornade.com/studio - accesso libero e gratuito, chiunque puo' registrarsi con la propria email, nessuna password condivisa da conoscere.
2. **Gate legacy** (`STUDIO_USER`/`STUDIO_PASS_SHA256`): una singola password condivisa, meccanismo storico ora **disattivato di default** (`VITE_STUDIO_LEGACY_LOGIN_ENABLED` non impostato). Va riattivato esplicitamente (`VITE_STUDIO_LEGACY_LOGIN_ENABLED=true`) solo se si vuole restringere l'accesso a un piccolo team/singolo operatore (es. una beta privata); una volta riattivato, se entrambi i meccanismi risultano configurati l'accesso richiede entrambi in sequenza (vedi `src/auth/combine-auth.ts`).

Con la configurazione di default (solo Supabase), l'accesso e' consentito a chiunque completi il login via magic link.

### File del progetto

| Percorso | Descrizione |
|----------|-------------|
| `src/studio/` | Stato dell'editor (`StudioContext`), tipi (`types.ts`), cataloghi preset/newsroom kit |
| `src/components/` | UI (pannelli step-by-step, canvas mappa/grafico, modali progetti/condivisione) |
| `src/lib/` | Logica pura: parsing dati, join geografici, classificazione, export, integrazioni (Overpass, Nominatim, Eurostat, CKAN...), CRUD Supabase |
| `src/auth/` | Gate legacy + auth Supabase, combinati in `combine-auth.ts` |
| `netlify/functions/` | Login/logout gate legacy, proxy CKAN/Eurostat/fetch generico, pubblicazione embed su object storage |
| `supabase/migrations/` | Schema del progetto Supabase dedicato (tabelle, RLS, trigger) |
| `supabase/functions/` | Edge Function per l'invio email di invito (Resend) |
| `supabase/tests/` | Suite pgTAP per schema/RLS/trigger |

---

## Prerequisiti

- **Node.js 20+** e npm
- Un **provider di object storage S3-compatibile** (es. DigitalOcean Spaces, AWS S3, Cloudflare R2) per la pubblicazione degli embed
- Facoltativo: un **progetto Supabase** proprio, per abilitare login per-utente e progetti su cloud/condivisione
- Facoltativo: una **API key [Resend](https://resend.com)** (o provider email equivalente), solo se si vuole l'email di notifica inviti

---

## Avvio rapido

```bash
git clone https://github.com/zornade/zornade-studio.git
cd zornade-studio

npm install

cp .env.example .env.local
# Configura VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY per il login via magic link
# (vedi sotto). Il gate legacy resta disattivato finche' non lo abiliti esplicitamente.

npm run dev
```

L'app è disponibile su `http://localhost:5173`. Senza ulteriore configurazione funziona con: cataloghi dati pubblici, tutte le visualizzazioni, editor completo e salvataggio file locale. Pubblicazione embed e progetti su cloud richiedono la configurazione descritta sotto.

### Build di produzione

```bash
npm run build      # tsc --noEmit && vite build
npm run preview    # serve la build in locale
```

---

## Configurazione

Tutte le variabili sono documentate in [.env.example](.env.example). Riepilogo:

### Gate legacy (disattivato di default - solo se vuoi restringere l'accesso)

| Variabile | Dove | Descrizione |
|-----------|------|-------------|
| `VITE_STUDIO_LEGACY_LOGIN_ENABLED` | Netlify / `.env.local` | Deve essere `true` per attivare il gate legacy. Assente = disattivato (default, comportamento del deploy ufficiale) |
| `STUDIO_USER` / `VITE_STUDIO_USER` | Netlify / `.env.local` | Nome utente della password condivisa |
| `STUDIO_PASS_SHA256` / `VITE_STUDIO_PASS_SHA256` | Netlify / `.env.local` | SHA-256 esadecimale della password (`printf '%s' 'password' \| sha256sum`) |
| `STUDIO_SESSION_SECRET` | Solo Netlify | Stringa casuale lunga per firmare il cookie di sessione (`openssl rand -hex 32`) |

In produzione (Netlify Functions) le variabili **senza** prefisso `VITE_` sono lette solo server-side. In sviluppo locale senza Netlify Functions si usano le equivalenti **con** prefisso `VITE_` in un `.env.local` (mai committato).

### Supabase (facoltativo - login per-utente, progetti su cloud, condivisione)

| Variabile | Descrizione |
|-----------|-------------|
| `VITE_SUPABASE_URL` | URL del **tuo** progetto Supabase dedicato |
| `VITE_SUPABASE_ANON_KEY` | Chiave anon/public (mai la service_role) |

Applica le migrazioni in `supabase/migrations/` al tuo progetto (`supabase db push --linked`) per creare lo schema (tabelle progetti/collaboratori, RLS, trigger). Se vuoi anche l'email di notifica inviti, deploya `supabase/functions/send-project-invite-email` e imposta il secret `RESEND_API_KEY` sul **tuo** progetto Supabase.

> Ogni deploy di Studio - incluso quello ufficiale su zornade.com - usa un proprio progetto Supabase dedicato, mai condiviso tra installazioni diverse: è esattamente ciò che dovrebbe fare anche chi fa self-hosting.

### Pubblicazione embed (facoltativo, solo Netlify Functions)

| Variabile | Descrizione |
|-----------|-------------|
| `SPACES_KEY` / `SPACES_SECRET` | Credenziali object storage S3-compatibile |
| `SPACES_BUCKET` / `SPACES_REGION` | Bucket e regione |
| `EMBED_BASE_URL` / `EMBED_GEO_BASE` | URL pubblici di base per gli embed pubblicati |

---

## Funzionalità principali

- **Editor step-by-step**: Dati → Struttura → Visualizza → Design → Pubblica, con anteprima live
- **Autosave locale**: il lavoro in corso è sempre recuperabile da `localStorage`, indipendentemente dal salvataggio esplicito
- **Export**: PNG ad alta risoluzione, PDF, embed HTML, dati CSV
- **Annotazioni** e **scrollytelling** (racconto a tappe con camera animata sulla mappa)
- **Classificazione dati**: quantile, naturali (Jenks), egual-intervallo, manuale, con palette accessibili (CVD-safe)

---

## Progetti su cloud e condivisione

Con Supabase configurato, dal pulsante **Progetti** in alto si accede a:

- **I miei progetti / Condivisi con me**: apri, rinomina, duplica, elimina (solo proprietario) qualunque progetto salvato
- **Condividi**: invita un collaboratore per email con ruolo **editor** (può modificare) o **visualizzatore** (sola lettura); se l'invitato non ha ancora un account, l'invito resta in attesa e si attiva automaticamente al primo accesso con la stessa email
- Il flusso a file (`.zornade.json`) resta sempre disponibile come backup/esportazione, indipendentemente dal cloud

---

## Sviluppo e contribuzione

Contributi benvenuti - leggi [CONTRIBUTING.md](CONTRIBUTING.md) prima di aprire una PR (in breve: **apri sempre una issue prima di scrivere codice**). Rispettiamo il [Codice di Condotta](CODE_OF_CONDUCT.md). Per problemi di sicurezza, segui [SECURITY.md](SECURITY.md) invece di aprire una issue pubblica.

```bash
npm install
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run test         # vitest run
```

---

## Autore

Sviluppato e mantenuto da [Zornade](https://zornade.com).

## Licenza

Il codice sorgente è distribuito sotto **GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)** - vedi [LICENSE](LICENSE) e [NOTICE](NOTICE) (quest'ultimo copre anche gli obblighi di attribuzione sugli output/embed, derivati dalle licenze dati come ODbL, non dall'AGPL).

È disponibile anche una **licenza commerciale separata** per chi non può/non vuole rispettare gli obblighi AGPL §13 in un prodotto proprietario - vedi [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).
