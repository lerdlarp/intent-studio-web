import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Own ports and a fresh data dir per run, so e2e never reuses (or pollutes) a dev server's database. No API key:
// every AI call takes the rules fallback.
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 3101);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174);
const dataDir = fileURLToPath(new URL('./test-results/server-data', import.meta.url));
// A second server with bearer auth (API_TOKEN) and its own web dev server, for tests/auth.spec.ts only.
const AUTH_SERVER_PORT = Number(process.env.E2E_AUTH_SERVER_PORT ?? 3102);
const AUTH_WEB_PORT = Number(process.env.E2E_AUTH_WEB_PORT ?? 5175);
const E2E_API_TOKEN = 'e2e-secret-token';
const authDataDir = fileURLToPath(new URL('./test-results/server-data-auth', import.meta.url));
const authCacheDir = fileURLToPath(new URL('./test-results/vite-cache-auth', import.meta.url));

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${WEB_PORT}` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /auth\.spec\.ts/ },
    {
      name: 'auth',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${AUTH_WEB_PORT}` },
      testMatch: /auth\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: `node -e "require('node:fs').rmSync(process.env.DATA_DIR,{recursive:true,force:true})" && pnpm --filter server start`,
      url: `http://localhost:${SERVER_PORT}/api/health`,
      reuseExistingServer: false,
      env: { PORT: String(SERVER_PORT), DATA_DIR: dataDir, ANTHROPIC_API_KEY: '' },
    },
    {
      command: `pnpm --filter web exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { API_PORT: String(SERVER_PORT) },
    },
    {
      command: `node -e "require('node:fs').rmSync(process.env.DATA_DIR,{recursive:true,force:true})" && pnpm --filter server start`,
      url: `http://localhost:${AUTH_SERVER_PORT}/api/health`,
      reuseExistingServer: false,
      env: { PORT: String(AUTH_SERVER_PORT), DATA_DIR: authDataDir, ANTHROPIC_API_KEY: '', API_TOKEN: E2E_API_TOKEN },
    },
    {
      command: `pnpm --filter web exec vite --port ${AUTH_WEB_PORT} --strictPort`,
      url: `http://localhost:${AUTH_WEB_PORT}`,
      reuseExistingServer: false,
      env: { API_PORT: String(AUTH_SERVER_PORT), VITE_CACHE_DIR: authCacheDir },
    },
  ],
});
