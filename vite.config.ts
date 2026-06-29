import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Zornade Studio - dev server config.
// The basemap tiles URL is provided via VITE_TILES_URL (see .env.example);
// it defaults to the public Protomaps demo bucket for local development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
  },
});
