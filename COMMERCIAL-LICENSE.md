# Licenza commerciale - Zornade Studio

> **TL;DR** - `zornade-studio` è distribuito sotto licenza **AGPL-3.0-or-later**.
> Se vuoi usarlo (o un fork modificato) in un servizio commerciale proprietario
> senza dover pubblicare il codice sorgente del tuo sistema combinato (auth,
> backend, integrazioni, branding), è disponibile una **licenza commerciale
> separata** acquistabile da [zornade](https://zornade.com).

---

## Quando ti serve una licenza commerciale

La licenza AGPL-3.0 impone obblighi forti **sia in caso di redistribuzione
del software**, sia - punto critico - **in caso di uso in rete** (clausola §13,
"Remote Network Interaction"). In sintesi, se metti online un servizio basato
su `zornade-studio` modificato, devi offrire pubblicamente il *Corresponding
Source* completo della tua opera combinata.

### Casi tipici in cui ti serve una licenza commerciale

- **SaaS o piattaforma B2B/B2C** che offre a clienti paganti un editor di
  mappe basato su `zornade-studio`, e non vuoi pubblicare il codice di:
  - autenticazione/billing/gestione utenti proprietaria
  - backend di persistenza progetti proprio (diverso da Supabase, o uno
    schema Supabase esteso con logica di business)
  - integrazioni dati proprietarie (dataset interni, connettori a sistemi terzi)
  - branding/tema white-label
- **Piattaforma interna aziendale** che integra `zornade-studio` con sistemi
  proprietari (CMS, data warehouse) e non vuoi essere obbligato a pubblicare
  quegli integration layer ai dipendenti come "utenti della rete".
- **Rimozione dell'attribuzione Zornade** dagli embed pubblicati per un
  prodotto white-label (l'attribuzione ai dati OpenStreetMap/ODbL resta
  comunque obbligatoria per legge - vedi [NOTICE](NOTICE) - ma il blocco
  "Fatto con Zornade Studio" è una condizione di prodotto che la licenza
  commerciale può derogare).
- **Software on-premise distribuito a clienti** dove non vuoi che la
  documentazione del prodotto contenga link al sorgente completo combinato.

### Quando NON ti serve una licenza commerciale

Puoi usare `zornade-studio` sotto AGPL-3.0 senza problemi se:

- Lo usi **personalmente o nella tua redazione, per i tuoi dati**.
- Lo usi in un **progetto open source compatibile** (AGPL-3.0 o licenze
  più permissive che accettano di passare ad AGPL-3.0).
- Sei disposto a pubblicare l'intero *Corresponding Source* del tuo sistema
  combinato sotto AGPL-3.0, comprese tutte le componenti private linkate.

---

## Cosa include una licenza commerciale

La licenza commerciale standard ti permette di:

1. **Integrare** `zornade-studio` in un prodotto/servizio proprietario senza
   l'obbligo di pubblicare il sorgente delle componenti combinate.
2. **Modificare** il codice e mantenere le modifiche private.
3. **Distribuire** il prodotto combinato a clienti finali (interni o esterni)
   senza obbligo di fornire il sorgente.
4. **Esporre il servizio in rete** senza dover offrire pubblicamente il
   *Corresponding Source* (AGPL §13 viene esplicitamente derogato dalla
   licenza commerciale).
5. **Rimuovere/personalizzare il branding di prodotto** (white-label),
   fermo restando l'obbligo di attribuzione ai dati di terze parti (OSM/ODbL).
6. **Ricevere updates** dal ramo upstream per la durata della licenza.

Termini negoziabili includono:

- Supporto tecnico prioritario via email / Slack / call.
- SLA dedicato.
- Roadmap di feature personalizzata.
- Audit & compliance review.
- Indennità su rivendicazioni di terzi sul codice upstream.

---

## Modello di pricing (indicativo)

| Tipologia                                          | Indicativo annuale (EUR) |
|----------------------------------------------------|--------------------------|
| Startup / piccola realtà (< 5 dipendenti, < 250k€ fatturato) | a partire da 990 €/anno  |
| PMI (< 50 dipendenti)                              | a partire da 4.900 €/anno |
| Enterprise / volumi non specificati                | personalizzato            |
| Licenza one-shot perpetua + 1 anno aggiornamenti   | personalizzato            |
| Sub-licensing a clienti finali (white-label)       | personalizzato            |

Il pricing dipende da: numero di deploy, traffico stimato, supporto richiesto,
indennità, durata contrattuale.

---

## Come acquistare

1. Scrivi a **`hello@zornade.com`** descrivendo brevemente:
   - L'uso previsto (SaaS / interno / on-premise / white-label)
   - Numero di deploy o utenti finali stimati
   - Componenti combinate principali (auth, backend, integrazioni, ecc.)
   - Necessità di rimuovere il branding Zornade dagli embed
   - Necessità di supporto o SLA
2. Riceverai una proposta entro **5 giorni lavorativi**.
3. Firma di NDA reciproca (opzionale, se richiesto).
4. Contratto firmato + bonifico → licenza emessa entro **48h dal pagamento**.

---

## Domande frequenti

**D: Ho già forkato il repository pubblico. Posso comprare la licenza dopo?**
R: Sì. La licenza commerciale è retroattiva al momento dell'acquisto: copre
tutti gli usi futuri del tuo fork, ma non sana eventuali violazioni AGPL già
commesse. È sempre meglio acquistarla *prima* del deploy.

**D: Esistono già fork pubblici sotto AGPL che hanno aggiunto features. Posso
prenderli e integrarli sotto licenza commerciale?**
R: No, non puoi: le modifiche apportate dai forker terzi sono di loro
copyright e tu non hai automaticamente diritto di relicensarle. Solo il
codice upstream di `zornade/zornade-studio` è coperto dalla nostra licenza
commerciale. Le modifiche di terzi puoi reimplementarle in autonomia, o
negoziare con i rispettivi autori.

**D: Cosa succede ai contributor del repo open source?**
R: Tutti i contributor accettano (firmando i commit con `--signoff` o tramite
DCO) di concedere al maintainer un grant di relicensing su contribuzioni
sufficiente a permettere la dual-licensing. Vedi `CONTRIBUTING.md`.

**D: L'obbligo di attribuzione OpenStreetMap/ODbL sparisce con la licenza
commerciale?**
R: No. Quello è un obbligo derivante dalla licenza dei DATI (ODbL), non
dall'AGPL del software: la licenza commerciale Zornade non può derogarlo,
può solo derogare il branding di prodotto Zornade stesso (es. il testo
"Fatto con Zornade Studio"). Vedi [NOTICE](NOTICE).

**D: Cosa devo fare se sono già in violazione di AGPL §13?**
R: Contattaci a `hello@zornade.com`. Nella maggior parte dei casi la
violazione si risolve con: (a) acquisto retroattivo di licenza commerciale a
copertura del periodo di uso, (b) impegno scritto a rispettare i termini
futuri. Le azioni legali sono l'ultima ratio.

---

## Contatti

- **Email**: `hello@zornade.com`
- **Sito**: https://zornade.com/licensing
- **PEC**: disponibile su richiesta
- **GitHub**: aprire una issue privata su https://github.com/zornade/zornade-studio
  con tag `licensing` (solo per inquiry non-confidenziali)

---

*Ultimo aggiornamento: 7 luglio 2026*
