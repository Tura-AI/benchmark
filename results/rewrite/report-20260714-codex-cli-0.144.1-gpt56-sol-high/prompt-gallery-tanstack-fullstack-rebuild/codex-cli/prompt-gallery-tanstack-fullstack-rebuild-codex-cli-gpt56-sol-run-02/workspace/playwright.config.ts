import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4177', trace: 'retain-on-failure' },
  webServer: { command: 'node .output/server/index.mjs', url: 'http://127.0.0.1:4177', reuseExistingServer: false, timeout: 60_000, env: { PORT: '4177', HOST: '127.0.0.1' } },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
