import { defineConfig, devices } from '@playwright/test'

// Playwright clears its output at startup. Keep the projection and authority
// invocations separate so the second cannot erase the first one's failed retry.
const suite = process.env.BUDDS_E2E_REAL_ADAPTIVE_CANVAS === 'true' ? 'authority' : 'learn'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  outputDir: `test-results/${suite}`,
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: `playwright-report/${suite}`, open: 'never' }], ['json', { outputFile: `test-results/${suite}/results.json` }]]
    : 'list',
  use: { baseURL: process.env.BUDDS_E2E_BASE_URL ?? 'http://127.0.0.1:3102', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'pnpm e2e:stack', url: 'http://127.0.0.1:3102', timeout: 120_000, reuseExistingServer: false },
})
