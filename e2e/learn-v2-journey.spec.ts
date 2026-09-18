import { expect, test } from '@playwright/test'

const token = process.env.BUDDS_E2E_AUTH_TOKEN ?? 'e2e-local-token-please-do-not-use-outside-tests'

function localScheduleWindow() {
  const now = new Date()
  const weekday = now.getDay() === 0 ? 7 : now.getDay()
  const start = new Date(now.getTime() + 2 * 60_000)
  const end = new Date(start.getTime() + 2 * 60 * 60_000)
  const time = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  return { weekday, date, start: time(start), end: time(end) }
}

test('learner can advance the Learn V2 mastery journey through production UI', async ({ page, request }) => {
  test.setTimeout(8 * 60_000)

  const identity = { email: `learn-v2-${Date.now()}@e2e.budds.invalid`, password: 'disposable-e2e-password', name: 'Learn V2 Browser Test' }
  const bootstrap = await request.post('/api/e2e/session', { headers: { 'x-budds-e2e-token': token }, data: identity })
  expect(bootstrap.ok()).toBeTruthy()
  const cookies = bootstrap.headersArray().filter(header => header.name.toLowerCase() === 'set-cookie').map(header => header.value)
  for (const cookie of cookies) {
    const [nameValue] = cookie.split(';')
    const separator = nameValue.indexOf('=')
    expect(separator).toBeGreaterThan(0)
    await page.context().addCookies([{ name: nameValue.slice(0, separator), value: nameValue.slice(separator + 1), url: 'http://127.0.0.1:3102' }])
  }

  const folderName = `Learn V2 E2E ${Date.now()}`
  await page.goto('/')
  await page.getByTestId('rail-create-folder').click()
  await expect(page.getByTestId('folder-form-modal')).toBeVisible()
  await page.getByTestId('folder-name-input').fill(folderName)
  await page.getByTestId('folder-form-submit').click()
  await expect(page.getByTestId('folder-form-modal')).toBeHidden()

  await page.goto('/app/learn/create')
  await expect(page.getByTestId('learn-v2-outcome-canvas')).toBeVisible()
  await page.getByTestId('learn-v2-create-folder').selectOption({ label: folderName })
  await page.getByTestId('learn-v2-outcome-input').fill('Explain orbital mechanics well enough to reason about a transfer orbit.')
  await page.getByLabel('Source policy').selectOption('web_only')
  await page.getByTestId('learn-v2-outcome-continue').click()
  await expect(page).toHaveURL(/\/app\/learn\/[^/]+\?section=sources/)
  await expect(page.getByTestId('learn-v2-evidence-desk')).toBeVisible()
  await page.getByTestId('learn-v2-source-url').fill('https://e2e.budds.invalid/source')
  await page.getByTestId('learn-v2-source-add-url').click()
  await expect(page.getByTestId('learn-v2-source-inspector')).toContainText('Deterministic accepted evidence')
  const acceptSource = page.locator('[data-testid^="learn-v2-source-accept-"]')
  await expect(acceptSource).toBeVisible()
  await acceptSource.click()
  await expect(page.getByTestId('learn-v2-evidence-desk')).toContainText('Accepted')
  await page.getByTestId('learn-v2-generate-map').click()
  await expect(page.getByTestId('learn-v2-map-generation-status')).toContainText(/completed|succeeded|ready/i, { timeout: 120_000 })

  await page.getByTestId('learn-v2-workspace-nav-map').click()
  await expect(page.getByTestId('learn-v2-learning-trail')).toBeVisible()
  await page.getByTestId('learn-v2-map-edit-objective').click()
  await page.getByTestId('learn-v2-objective-title').fill('Explain transfer orbits')
  await page.getByTestId('learn-v2-objective-capability').fill('Apply orbital mechanics to choose and explain a transfer orbit.')
  await page.getByTestId('learn-v2-save-objective').click()
  await expect(page.getByTestId('learn-v2-accept-map')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('learn-v2-accept-map').click()

  await page.getByTestId('learn-v2-workspace-next-action').click()
  await expect(page).toHaveURL(/\/calibration$/)
  for (let attempt = 1; attempt <= 3; attempt++) {
    await expect(page.getByTestId('learn-v2-calibration-response')).toBeVisible()
    await page.getByTestId('learn-v2-calibration-response').fill(`Cold attempt ${attempt}: I would explain the transfer orbit from the accepted source.`)
    await page.getByTestId('learn-v2-calibration-submit').click()
    await expect(page.getByTestId('learn-v2-calibration')).toContainText(new RegExp(`${attempt} of 3`), { timeout: 30_000 })
  }
  await page.getByTestId('learn-v2-calibration-complete').click()
  await expect(page).toHaveURL(/\?section=plan$/)
  await expect(page.getByTestId('learn-v2-schedule-editor')).toBeVisible()

  const window = localScheduleWindow()
  await page.getByTestId('learn-v2-schedule-timezone').fill(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
  await page.getByTestId('learn-v2-schedule-start').fill(window.date)
  await page.getByTestId(`learn-v2-schedule-day-${window.weekday}`).check()
  await page.getByTestId(`learn-v2-schedule-window-start-${window.weekday}`).fill(window.start)
  await page.getByTestId(`learn-v2-schedule-window-end-${window.weekday}`).fill(window.end)
  await page.getByTestId('learn-v2-create-plan-preview').click()
  await expect(page.getByTestId('learn-v2-study-rhythm')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('learn-v2-study-rhythm')).toContainText(/feasible/i)
  await page.getByTestId('learn-v2-accept-plan').click()

  await page.getByTestId('learn-v2-workspace-next-action').click()
  await expect(page).toHaveURL(/\/sessions\/[^/]+$/, { timeout: 120_000 })
  await expect(page.getByTestId('learn-v2-session')).toBeVisible({ timeout: 120_000 })
  await expect(page.getByTestId('learn-v2-start')).toBeEnabled({ timeout: 120_000 })
  await page.getByTestId('learn-v2-start').click()

  await expect(page.getByTestId('learn-v2-phase-retrieval')).toBeVisible()
  await page.getByTestId('learn-v2-continue').click()
  await expect(page.getByTestId('learn-v2-phase-prediction')).toBeVisible()
  await page.getByLabel('Your prediction').fill('A transfer orbit changes velocity at the right orbital points.')
  await page.getByTestId('learn-v2-continue').click()
  await expect(page.getByTestId('learn-v2-phase-teaching')).toBeVisible()
  await page.getByTestId('learn-v2-continue').click()
  await expect(page.getByTestId('learn-v2-phase-fading')).toBeVisible()
  await page.getByLabel('Your faded-practice response').fill('I would select the transfer orbit by comparing the required velocity changes.')
  await page.getByTestId('learn-v2-continue').click()
  await expect(page.getByTestId('learn-v2-phase-transfer')).toBeVisible()
  await page.getByLabel('Your transfer response').fill('For a new pair of circular orbits, I would apply the same transfer reasoning.')
  await page.getByTestId('learn-v2-continue').click()
  await expect(page.getByTestId('learn-v2-phase-confidence')).toBeVisible()
  await page.getByLabel('Teach it back').fill('The transfer orbit is a deliberate path between two orbital energies.')
  await page.getByRole('radio', { name: '4 out of 5' }).check()
  await page.getByTestId('learn-v2-submit').click()
  await expect(page.getByTestId('learn-v2-feedback')).toBeVisible({ timeout: 120_000 })
  await page.getByTestId('learn-v2-next-review').click()
  await expect(page.getByTestId('learn-v2-next-review-panel')).toBeVisible()
})
