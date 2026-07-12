import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e', timeout: 30_000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build && npm run start',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
    timeout: 180_000,
    env: { POWERPROMPT_DB_PATH: 'data/e2e.db', PORT: '3000' },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } }],
})
