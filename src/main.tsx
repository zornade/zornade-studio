import React from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6: registra l'URL del worker prima che venga creata qualsiasi mappa
import "./lib/maplibre-worker.ts";
import "./index.css";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) {
  throw new Error('Root element "#root" not found');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
