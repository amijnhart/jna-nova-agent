import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "/" hoort bij subdomein agent.jna-events.nl (app in hoofdmap)
// Wil je het op de hoofddomein (jna-events.nl) of een subdomein (agent.jna-events.nl)?
// Wil je toch een submap zoals /agent? Zet base op "/agent/".
export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    port: 5173,
    // Tijdens lokaal ontwikkelen worden /api-aanvragen doorgestuurd naar je backend op poort 8787
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
