# Registro delle modifiche

Tutte le modifiche rilevanti a questo progetto saranno documentate in questo file.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
e questo progetto aderisce al [Versionamento Semantico](https://semver.org/lang/it/).

## [Non rilasciato]

### Aggiunto

- **Preparazione OSS**: licenza AGPL-3.0-or-later, `NOTICE` con gli obblighi
  di attribuzione sugli output (OpenStreetMap/ODbL), `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, `COMMERCIAL-LICENSE.md`, template
  issue/PR e workflow CI (`typecheck`/`lint`/`test`).
- **Autenticazione per-utente (Supabase, additiva al gate legacy)**: login
  via magic link email, indipendente dalla password condivisa storica -
  entrambi i meccanismi restano attivi, il gate legacy resta primario.
- **Progetti su cloud**: persistenza server-side dei progetti (oltre al
  salvataggio a file già esistente), con interfaccia "I miei progetti /
  Condivisi con me" (apri, rinomina, duplica, elimina).
- **Condivisione progetti**: invito di collaboratori per email con ruolo
  editor/visualizzatore, notifica email di invito, gestione ruoli e rimozione
  collaboratori, inviti pendenti risolti automaticamente al primo accesso
  dell'invitato.
- Row Level Security completa (proprietario/editor/visualizzatore) sulle
  tabelle dei progetti e dei collaboratori, verificata con una suite pgTAP
  dedicata prima di ogni modifica allo schema.

## Prima della cronologia pubblica

Zornade Studio è nato ed è stato sviluppato come strumento di produzione
interno, poi aperto come progetto OSS a partire da questa versione. Le
funzionalità core (editor step-by-step dati → struttura → visualizzazione →
design → pubblicazione, i tipi di visualizzazione supportati, l'integrazione
con OpenStreetMap/Overpass/Eurostat, l'export PNG/PDF/embed) sono state
sviluppate prima dell'apertura del repository e non hanno una cronologia
dettagliata in questo changelog.
