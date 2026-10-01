import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const token = process.env.BUDDS_E2E_AUTH_TOKEN ?? 'e2e-local-token-please-do-not-use-outside-tests'

async function saveRoutedDiagnostic(page: Page, request: APIRequestContext) {
  const bootstrap = await request.post('/api/e2e/session', {
    headers: { 'x-budds-e2e-token': token },
    data: { email: `adaptive-${Date.now()}@e2e.budds.invalid`, password: 'disposable-e2e-password', name: 'Adaptive Browser Test' },
  })
  expect(bootstrap.ok()).toBeTruthy()
  for (const header of bootstrap.headersArray().filter(header => header.name.toLowerCase() === 'set-cookie')) {
    const [nameValue] = header.value.split(';')
    const separator = nameValue.indexOf('=')
    expect(separator).toBeGreaterThan(0)
    await page.context().addCookies([{
      name: nameValue.slice(0, separator), value: nameValue.slice(separator + 1), url: 'http://127.0.0.1:3102',
    }])
  }

  await page.goto('/app/learn')
  await expect.poll(async () => {
    if (await page.getByTestId('learn-adaptive-home').isVisible()) return true
    await page.reload({ waitUntil: 'domcontentloaded' })
    return false
  }, { timeout: 120_000, intervals: [5_000] }).toBe(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('learn-adaptive-home')).toHaveAttribute('data-hydrated', 'true')
  await expect(page.getByRole('main').last()).toHaveAttribute('data-owner-ready', 'true')
  await page.getByTestId('learn-adaptive-need').fill('Explain why an orbiting satellite does not fall straight down.')
  await page.getByTestId('learn-adaptive-start').click()
  await expect(page.getByTestId('learn-initial-decision')).toBeVisible({ timeout: 30_000 })
  if (await page.getByTestId('learn-clarification-skip').isVisible()) await page.getByTestId('learn-clarification-skip').click()
  await expect(page.getByTestId('learn-adaptive-open-diagnostic')).toBeVisible()
  await page.getByTestId('learn-adaptive-open-diagnostic').click()
  await expect(page).toHaveURL(/\/app\/learn\/thread\/[^/]+$/)
  await expect(page.getByTestId('learn-diagnostic-canvas')).toBeVisible()
  await page.getByTestId('learn-diagnostic-start').click()
  const response = 'The satellite keeps falling while its sideways velocity carries it around Earth.'
  await page.getByTestId('learn-diagnostic-response').fill(response)
  await page.getByTestId('learn-diagnostic-submit').click()
  await expect(page.getByTestId('learn-diagnostic-saved')).toContainText(response)
  return { threadUrl: page.url(), response }
}

test('routed diagnostic persists the learner response through the disposable backend', async ({ page, request }) => {
  test.setTimeout(4 * 60_000)
  const { response } = await saveRoutedDiagnostic(page, request)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('learn-diagnostic-saved')).toContainText(response)
})

test('server-owned rollback hides the routed Canvas and restores saved work', async ({ page, request }) => {
  test.setTimeout(5 * 60_000)
  const { threadUrl, response } = await saveRoutedDiagnostic(page, request)

  await page.goto('/__e2e/adaptive-access')
  await expect(page.getByTestId('adaptive-access-disable')).toBeEnabled()
  await page.getByTestId('adaptive-access-disable').click()
  await expect(page.getByRole('status')).toHaveText('Adaptive access rolled back.')
  await expect(page.getByTestId('adaptive-access-status')).toHaveText('denied')

  for (const viewport of [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 375, height: 667 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto(threadUrl)
    const denied = page.getByTestId('learn-adaptive-thread-denied')
    await expect(denied, `${viewport.name}: rolled-back route`).toBeVisible()
    await expect(denied.getByRole('status')).toHaveText('This learning thread is not available for this account.')
    await expect(page.getByTestId('learn-adaptive-canvas-frame')).toHaveCount(0)
    const recovery = denied.getByRole('link', { name: 'Open V2 learning plans' })
    await expect(recovery).toHaveAttribute('href', '/app/learn?legacy=v2')
    const bounds = await recovery.boundingBox()
    expect(bounds, `${viewport.name}: safe action bounds`).not.toBeNull()
    expect(bounds!.height, `${viewport.name}: safe action target`).toBeGreaterThanOrEqual(44)
    expect(bounds!.x + bounds!.width, `${viewport.name}: reflow`).toBeLessThanOrEqual(viewport.width + 1)
    await recovery.focus()
    await expect(recovery).toBeFocused()
  }

  await page.getByRole('link', { name: 'Open V2 learning plans', exact: true }).first().click()
  await expect(page).toHaveURL(/\/app\/learn\?legacy=v2$/)
  await expect(page.getByTestId('learn-adaptive-home')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Existing learning routes' })).toBeVisible()

  await page.goto('/__e2e/adaptive-access')
  await expect(page.getByTestId('adaptive-access-enable')).toBeEnabled()
  await page.getByTestId('adaptive-access-enable').click()
  await expect(page.getByRole('status')).toHaveText('Adaptive access restored.')
  await expect(page.getByTestId('adaptive-access-status')).toHaveText('allowed')
  await page.goto(threadUrl)
  await expect(page.getByTestId('learn-diagnostic-saved')).toContainText(response)
})
