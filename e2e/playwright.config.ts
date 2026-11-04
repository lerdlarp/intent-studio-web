import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://localhost:5173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'pnpm --filter server start', url: 'http://localhost:3001/api/health', reuseExistingServer: true },
    { command: 'pnpm --filter web dev', url: 'http://localhost:5173', reuseExistingServer: true },
  ],
});
