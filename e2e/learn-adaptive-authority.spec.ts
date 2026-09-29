import { expect, test } from '@playwright/test'

const token = process.env.BUDDS_E2E_AUTH_TOKEN ?? 'e2e-local-token-please-do-not-use-outside-tests'

test('routed diagnostic persists the learner response through the disposable backend', async ({ page, request }) => {
  test.setTimeout(4 * 60_000)
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
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('learn-diagnostic-saved')).toContainText(response)
})
