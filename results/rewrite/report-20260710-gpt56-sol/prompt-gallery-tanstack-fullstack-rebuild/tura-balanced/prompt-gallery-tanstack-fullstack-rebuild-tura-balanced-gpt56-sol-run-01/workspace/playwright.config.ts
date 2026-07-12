import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
  use: { baseURL: 'http://127.0.0.1:43127', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev -- --port 43127 --strictPort', url: 'http://127.0.0.1:43127', reuseExistingServer: false, timeout: 120_000, stdout: 'pipe', stderr: 'pipe' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
