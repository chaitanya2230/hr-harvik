import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * AGENTS.md §3 — static build only, no SSR. `vite build` emits `dist/`, which
 * nginx serves; `/api` is reverse-proxied so the browser sees a single origin
 * and the httpOnly refresh cookie is sent same-origin.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/health': { target: 'http://localhost:4000', changeOrigin: true },
      '/ready': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    // AGENTS.md §9 — `/assets` is a required React route (the asset
    // inventory). Vite's default output directory is also `dist/assets`,
    // so a production build made the SPA route collide with the hashed
    // bundle directory: nginx resolved `/assets/` to the real folder and
    // every inventory deep link (`/assets/AST-0001`, `/assets/new`, …)
    // answered 404 while `/assets` issued a directory redirect to a
    // port-less URL. Emitting bundles under `dist/static/` keeps the whole
    // `/assets/*` namespace free for client-side routing.
    assetsDir: 'static',
  },
});