import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.e2e\.ts/,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:3120',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run build && node --experimental-strip-types --no-warnings scripts/serve-built.mjs --port=3120',
    url: 'http://127.0.0.1:3120',
    reuseExistingServer: false,
    timeout: 240_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
