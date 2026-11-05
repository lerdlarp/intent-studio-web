import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev proxy: /api → the Fastify server (apps/server, PORT 3001 by default).
const api = process.env.API_URL ?? `http://localhost:${process.env.API_PORT ?? 3001}`;

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': api } },
});
