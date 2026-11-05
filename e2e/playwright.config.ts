import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// Own ports and a fresh data dir per run, so e2e never reuses (or pollutes) a dev server's database. No API key:
// every AI call takes the rules fallback.
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 3101);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174);
const dataDir = fileURLToPath(new URL('./test-results/server-data', import.meta.url));

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${WEB_PORT}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `rm -rf "${dataDir}" && pnpm --filter server start`,
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
  ],
});
