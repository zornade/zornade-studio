# Politica di sicurezza

## Segnalare una vulnerabilità

Se trovi una vulnerabilità di sicurezza in Zornade Studio, **NON** aprire una issue pubblica.

Invece, segnalala in modo responsabile tramite uno dei seguenti canali:

1. **GitHub Security Advisory**: usa la funzione [Segnala una vulnerabilità](https://github.com/zornade/zornade-studio/security/advisories/new) direttamente su GitHub
2. **Email**: contatta i manutentori tramite il profilo GitHub

### Cosa includere nella segnalazione

- Descrizione della vulnerabilità
- Passi per riprodurla
- Possibile impatto
- Eventuali suggerimenti per la correzione

### Tempi di risposta

- **Conferma di ricezione**: entro 48 ore
- **Prima valutazione**: entro 7 giorni
- **Correzione**: dipende dalla gravità, ma ci impegniamo a risolvere le vulnerabilità critiche il prima possibile

## Pratiche di sicurezza del progetto

### Credenziali e segreti

- Le credenziali del gate legacy (`STUDIO_USER`, `STUDIO_PASS_SHA256`, `STUDIO_SESSION_SECRET`), le chiavi Supabase, le credenziali dell'object storage (`SPACES_KEY`/`SPACES_SECRET`) e la chiave `RESEND_API_KEY` **non devono mai** essere committate nel repository
- Usa sempre `.env`/`.env.local` (inclusi nel `.gitignore`) per le credenziali locali
- In produzione, usa le variabili d'ambiente di Netlify e i secret del progetto Supabase, mai file committati
- La chiave **anon/public** di Supabase (`VITE_SUPABASE_ANON_KEY`) è pensata per essere esposta al client: l'unica barriera di sicurezza reale sono le policy **Row Level Security** sulle tabelle - non usare mai la chiave `service_role` lato client

### Modello di autorizzazione (Supabase)

Se configuri il backend Supabase (progetti su cloud/condivisione):

- Ogni tabella (`studio_projects`, `studio_project_collaborators`, `profiles`) ha **Row Level Security abilitata** con policy esplicite per proprietario/editor/visualizzatore - non disabilitarla e non concedere `BYPASSRLS` al ruolo `anon`/`authenticated`
- Le funzioni `SECURITY DEFINER` (`studio_is_project_owner`, `studio_collaborator_role`, `studio_find_collaborator_candidate`) esistono per evitare ricorsione RLS tra tabelle collegate - se le modifichi, mantieni `set search_path = public` esplicito per evitare hijacking dello schema
- La Edge Function `send-project-invite-email` verifica esplicitamente che il chiamante sia il **proprietario** del progetto (non un qualunque utente autenticato) prima di inviare l'email - qualunque modifica a quella funzione deve preservare questo controllo

### Dati sensibili

Questo progetto gestisce dati caricati dagli utenti (CSV, GeoJSON, dataset propri) che possono contenere informazioni personali. Assicurati di:

- Non includere mai dati reali/personali nei test o nella documentazione
- Rimuovere dati personali dai log prima di condividerli
- Rispettare la normativa sulla protezione dei dati personali (GDPR) per qualunque deploy pubblico

### Attribuzione dati (non è una questione di sicurezza, ma di licenza)

Gli embed pubblicati includono un blocco di attribuzione obbligatorio (OpenStreetMap/ODbL, vedi [NOTICE](NOTICE)) che non va rimosso: non è un obbligo di sicurezza ma una condizione di licenza dei dati sottostanti.

### Dipendenze

- Le dipendenze sono specificate in `package.json` con range di versione; il lockfile (`package-lock.json`) garantisce build riproducibili
- Aggiorna regolarmente le dipendenze per includere le patch di sicurezza
- Usa `npm audit` per verificare la presenza di vulnerabilità note

## Versioni supportate

| Versione | Supportata |
|----------|-----------|
| Ultima   | Sì        |
| Vecchie  | No        |

Solo l'ultima versione del progetto riceve aggiornamenti di sicurezza.
