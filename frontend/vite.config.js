import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The Flask API runs on :5000 by default. Proxying /api avoids CORS entirely in dev.
const target = process.env.VITE_PROXY_TARGET || "http://localhost:5000";
const proxy = { "/api": { target, changeOrigin: true } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
});
