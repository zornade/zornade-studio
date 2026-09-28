/**
 * Verifica gli endpoint Overpass dello Studio: copertura globale e CSP.
 *
 * Perche' non basta guardare la latenza: `overpass.osm.ch` risponde in 0,4 s ed
 * e' ritagliato sulla Svizzera, quindi da' 0 elementi per una ricerca in Italia
 * senza restituire nessun errore. Un endpoint regionale in testa alla lista
 * rompe in silenzio ogni ricerca fuori dal suo paese. Il controllo giusto e' la
 * stessa query su due riquadri lontani **contando gli elementi**: un endpoint
 * planetario risponde con elementi in entrambi, uno regionale con zero fuori
 * casa sua.
 *
 * Verifica anche che ogni host della lista sia nella `connect-src` di
 * `netlify.toml`: un endpoint aggiunto solo al codice viene bloccato dal
 * browser, e il riordino non produce nessun effetto.
 *
 * Uso: node scripts/verifica-endpoint-overpass.mjs
 */

import { readFile } from 'node:fs/promises';

const LIB = 'src/lib/overpass.ts';
const NETLIFY = 'netlify.toml';

// Due riquadri lontani: se un endpoint e' regionale, uno dei due resta vuoto.
const RIQUADRI = {
  'Roma (IT)': '41.88,12.45,41.92,12.52',
  'Zurigo (CH)': '47.36,8.52,47.39,8.56',
};

function endpointDallaLista(sorgente) {
  const blocco = sorgente.match(/export const OVERPASS_ENDPOINTS = \[([\s\S]*?)\];/);
  if (!blocco) throw new Error(`non trovo OVERPASS_ENDPOINTS in ${LIB}`);
  return [...blocco[1].matchAll(/"(https:\/\/[^"]+)"/g)].map((m) => m[1]);
}

/**
 * Gli host ammessi dalla CSP, letti dal valore della direttiva e non dal file:
 * `netlify.toml` cita `connect-src` anche in tre commenti, e leggerli per
 * posizione fa fallire il controllo su una riga di spiegazione.
 */
function hostAmmessi(toml) {
  const valori = [...toml.matchAll(/Content-Security-Policy = "([^"]*)"/g)].map((m) => m[1]);
  return valori.map((valore) => valore.match(/connect-src ([^;]*)/)?.[1] ?? '');
}

async function contaElementi(url, bbox) {
  const query = `[out:json][timeout:25];node[amenity=drinking_water](${bbox});out 200;`;
  const richiesta = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      // L'header Origin serve a far rispondere l'endpoint con
      // Access-Control-Allow-Origin: senza, la risposta non lo contiene e il
      // controllo direbbe che manca il CORS anche quando c'e'.
      'Origin': 'https://studio.zornade.com',
      'User-Agent': 'Zornade-studio/1.0 (verifica endpoint Overpass)',
    },
    body: query,
    signal: AbortSignal.timeout(40_000),
  });
  if (!richiesta.ok) throw new Error(`HTTP ${richiesta.status}`);
  const cors = richiesta.headers.get('access-control-allow-origin');
  const corpo = await richiesta.json();
  return { elementi: (corpo.elements ?? []).length, cors };
}

const sorgente = await readFile(LIB, 'utf8');
const endpoints = endpointDallaLista(sorgente);
const blocchiCsp = hostAmmessi(await readFile(NETLIFY, 'utf8'));

console.log(`endpoint configurati: ${endpoints.length}`);
console.log(`direttive CSP con connect-src: ${blocchiCsp.length}`);
const problemi = [];
const avvisi = [];
let verificati = 0;

for (const url of endpoints) {
  const esiti = [];
  for (const [luogo, bbox] of Object.entries(RIQUADRI)) {
    let esito = null;
    for (let tentativo = 1; tentativo <= 2 && !esito; tentativo++) {
      try {
        esito = { ...(await contaElementi(url, bbox)), tentativo };
      } catch (errore) {
        esito = { errore: errore.message, tentativo };
        if (tentativo === 1) await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (esito.errore) {
      // Un 504 o un timeout sono transitori e non dicono nulla sulla copertura:
      // si segnalano, ma non fanno fallire il controllo.
      esiti.push(`${luogo}: non verificabile (${esito.errore})`);
      avvisi.push(`${url}: nessuna risposta su ${luogo} (${esito.errore})`);
      continue;
    }
    verificati++;
    esiti.push(`${luogo}: ${esito.elementi} elementi (cors ${esito.cors ?? 'ASSENTE'})`);
    // La risposta arrivata ma vuota e' il difetto vero: un endpoint regionale
    // risponde 200 con zero elementi e nessun errore.
    if (esito.elementi === 0) problemi.push(`${url}: 0 elementi su ${luogo}, endpoint non planetario`);
    if (!esito.cors) problemi.push(`${url}: risposta senza Access-Control-Allow-Origin`);
  }
  const host = new URL(url).host;
  blocchiCsp.forEach((blocco, indice) => {
    if (!blocco.includes(host)) {
      problemi.push(`${url}: host assente dalla connect-src della direttiva CSP ${indice + 1} di ${NETLIFY}`);
    }
  });
  console.log(`  ${host}\n    ${esiti.join('\n    ')}`);
}

if (verificati === 0) {
  problemi.push('nessun endpoint ha risposto: copertura non verificata');
}
if (avvisi.length) {
  console.warn(`\nAVVISI (${avvisi.length}):`);
  for (const avviso of avvisi) console.warn(`  - ${avviso}`);
}
if (problemi.length) {
  console.error(`\nPROBLEMI (${problemi.length}):`);
  for (const problema of problemi) console.error(`  - ${problema}`);
  process.exit(1);
}
console.log('\nendpoint planetari, con CORS, e tutti presenti nella CSP');
