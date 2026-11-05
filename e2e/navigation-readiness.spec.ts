import { expect, test } from '@playwright/test'
import { waitForView } from './helpers/wait-for-view'

test('readiness follows an in-flight browser navigation without competing reloads', async ({ page }) => {
  let startingRequests = 0
  const browserNavigation = await page.context().newCDPSession(page)
  await page.route('http://readiness.invalid/**', async (route) => {
    if (route.request().url().endsWith('/ready')) {
      await route.fulfill({ contentType: 'text/html', body: '<main data-testid="ready-view">Ready</main>' })
      return
    }
    if (++startingRequests > 1) {
      // Keep the manual reload in flight when the initial document navigates.
      await browserNavigation.send('Page.navigate', { url: 'http://readiness.invalid/ready' })
      await route.abort()
      return
    }
    await route.fulfill({
      contentType: 'text/html',
      body: '<script>setTimeout(() => location.replace("/ready"), 100)</script><main>Starting</main>',
    })
  })
  await page.goto('http://readiness.invalid/starting')
  await waitForView(page, 'ready-view')
  await expect(page).toHaveURL('http://readiness.invalid/ready')
})

test('readiness still fails when the expected view never mounts', async ({ page }) => {
  await page.route('http://readiness.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<main>Unavailable</main>' }))
  await page.goto('http://readiness.invalid/unavailable')
  await expect(waitForView(page, 'ready-view', 100)).rejects.toThrow("getByTestId('ready-view')")
})
