// =====================================================
// MAPLIBRE 6 - REGISTRAZIONE DELL'URL DEL WORKER
// =====================================================
// Da maplibre-gl 6 la libreria e' distribuita solo come ESM e il worker viene
// caricato da un URL vero, ricavato a runtime da `import.meta.url` con il nome
// del file calcolato in una variabile. Dentro un bundler quel calcolo non punta
// al file emesso: il browser chiede un percorso inesistente, il fallback SPA
// risponde `index.html` e si ottiene
// "Failed to load module script: ... non-JavaScript MIME type of text/html"
// seguito da "Worker failed to load", quindi nessuna mappa si disegna.
//
// La documentazione ufficiale di maplibre prescrive per Vite la forma
// `?worker&url` e non `?url`: il file del worker importa il modulo gemello
// `maplibre-gl-shared.mjs`, e con `?url` verrebbe copiato cosi' com'e' senza il
// gemello, spezzandosi al primo import. `?worker&url` passa invece il file dal
// pipeline worker di Vite, che emette un chunk autonomo.
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(maplibreWorkerUrl);
