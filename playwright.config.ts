import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]] : 'list',
  use: { baseURL: process.env.BUDDS_E2E_BASE_URL ?? 'http://127.0.0.1:3102', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Startup includes a complete disposable application build.
  webServer: { command: 'pnpm e2e:stack', url: 'http://127.0.0.1:3102', timeout: 300_000, reuseExistingServer: false },
})
