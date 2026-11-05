import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: /api → the Fastify server (apps/server, PORT 3001 by default).
const api = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;

export default defineConfig({
  plugins: [react()],
  // a second dev server (e2e auth project) runs beside the first: give it its own dependency cache
  ...(process.env.VITE_CACHE_DIR ? { cacheDir: process.env.VITE_CACHE_DIR } : {}),
  server: { proxy: { '/api': api } },
  // Dependencies reached only through lazy imports (exports, 3D, PDF). Pre-bundled up front so the dev server does not
  // discover them on first use, re-optimize and reload the page mid-session (it dropped the open room).
  optimizeDeps: {
    include: [
      'three',
      'three/examples/jsm/exporters/GLTFExporter.js',
      'three/examples/jsm/loaders/GLTFLoader.js',
      'three/examples/jsm/controls/OrbitControls.js',
      'jspdf',
    ],
  },
});
