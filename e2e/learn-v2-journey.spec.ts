import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const token = process.env.BUDDS_E2E_AUTH_TOKEN ?? 'e2e-local-token-please-do-not-use-outside-tests'

function localScheduleWindow() {
  const now = new Date()
  const zones = ['America/Toronto', 'America/Los_Angeles', 'Pacific/Honolulu', 'Europe/London', 'Asia/Tokyo', 'Australia/Sydney']
  const partsFor = (date: Date, timeZone: string) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]))
  const timezone = zones.find((zone) => {
    const hour = Number(partsFor(now, zone).hour)
    return hour >= 8 && hour <= 18
  }) ?? 'UTC'
  const start = new Date(now.getTime() + 2 * 60_000)
  const end = new Date(start.getTime() + 2 * 60 * 60_000)
  const startParts = partsFor(start, timezone)
  const endParts = partsFor(end, timezone)
  const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[startParts.weekday]
  if (!weekday) throw new Error(`Could not resolve the weekday for ${timezone}`)
  return { timezone, weekday, date: `${startParts.year}-${startParts.month}-${startParts.day}`, start: `${startParts.hour}:${startParts.minute}`, end: `${endParts.hour}:${endParts.minute}` }
}

test('learner can advance the Learn V2 mastery journey through production UI', async ({ page, request }) => {
  test.setTimeout(8 * 60_000)
  page.setDefaultTimeout(30_000)

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
  await page.goto('/app/learn/create')
  await expect.poll(async () => {
    if (await page.getByTestId('learn-v2-outcome-canvas').isVisible()) return true
    await page.reload({ waitUntil: 'domcontentloaded' })
    return false
  }, { timeout: 120_000, intervals: [5_000] }).toBe(true)
  await page.getByTestId('new-root-folder-button').click()
  await expect(page.getByTestId('folder-form-modal')).toBeVisible()
  await page.getByTestId('folder-name-input').fill(folderName)
  await page.getByTestId('folder-form-submit').click()
  await expect(page.getByTestId('folder-form-modal')).toBeHidden()

  const folderOption = page.getByTestId('learn-v2-create-folder').locator('option', { hasText: folderName })
  await expect(folderOption).toHaveCount(1)
  const folderId = await folderOption.getAttribute('value')
  expect(folderId).toBeTruthy()
  await page.goto(`/app/folders/${folderId}/documents`)
  await expect(page.getByTestId('documents-file-upload-input')).toHaveAttribute('data-hydrated', 'true')
  const fixture = await readFile(new URL('./fixtures/learn-v2-orbital-mechanics.md', import.meta.url))
  await page.getByTestId('documents-file-upload-input').setInputFiles({ name: 'learn-v2-orbital-mechanics.md', mimeType: 'text/markdown', buffer: fixture })
  const documentRow = page.getByTestId('files-list').locator('[data-testid^="file-row-"]').filter({ hasText: 'learn-v2-orbital-mechanics.md' })
  await expect(documentRow).toBeVisible({ timeout: 30_000 })
  await expect(documentRow.locator('[data-status="success"]')).toBeVisible({ timeout: 120_000 })

  await page.goto('/app/learn')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page).not.toHaveTitle(/500 - Internal Server Error/)
  await expect(page.locator('body')).not.toContainText('useLearnV2Journey is not defined')

  await page.goto('/app/learn/create')
  await expect.poll(async () => {
    if (await page.getByTestId('learn-v2-outcome-canvas').isVisible()) return true
    await page.reload({ waitUntil: 'domcontentloaded' })
    return false
  }, { timeout: 120_000, intervals: [5_000] }).toBe(true)
  await page.getByTestId('learn-v2-create-folder').selectOption(folderId!)
  await page.getByTestId('learn-v2-outcome-input').fill('Explain orbital mechanics well enough to reason about a transfer orbit.')
  await page.getByLabel('Source policy').selectOption('folder_only')
  await page.getByTestId('learn-v2-outcome-continue').click()
  await expect(page).toHaveURL(/\/app\/learn\/[^/]+\?section=sources/)
  await expect(page.getByTestId('learn-v2-evidence-desk')).toBeVisible()
  // A hard refresh exercises the SSR entry path. Client-side navigation alone
  // does not catch missing server imports for newly added composables.
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page).not.toHaveTitle(/500 - Internal Server Error/)
  await expect(page.getByTestId('learn-v2-evidence-desk')).toBeVisible()
  const folderSource = page.locator('[data-testid^="learn-v2-source-row-"]').filter({ hasText: 'learn-v2-orbital-mechanics.md' })
  await expect(folderSource).toBeVisible()
  await folderSource.click()
  const prepareSource = page.locator('[data-testid^="learn-v2-source-prepare-"]')
  await expect(prepareSource).toBeVisible()
  await prepareSource.click()
  const acceptSource = page.locator('[data-testid^="learn-v2-source-accept-"]')
  await expect(acceptSource).toBeVisible({ timeout: 30_000 })
  await acceptSource.click()
  await expect(page.getByTestId('learn-v2-evidence-desk')).toContainText('Accepted')
  await page.getByTestId('learn-v2-generate-map').click()
  await expect(page.getByTestId('learn-v2-map-generation-status')).toContainText(/ready for review/i, { timeout: 120_000 })

  await page.getByTestId('learn-v2-workspace-nav-map').click()
  await expect(page.getByTestId('learn-v2-learning-trail')).toBeVisible()
  await page.getByTestId('learn-v2-map-edit-objective').click()
  await page.getByTestId('learn-v2-objective-title').fill('Explain transfer orbits')
  await page.getByTestId('learn-v2-objective-capability').fill('Apply orbital mechanics to choose and explain a transfer orbit.')
  await page.getByTestId('learn-v2-save-objective').click()
  await expect(page.getByTestId('learn-v2-accept-map')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('learn-v2-accept-map').click()

  const calibrateAction = page.getByTestId('learn-v2-workspace-next-action')
  await expect(calibrateAction).toContainText('Calibrate your starting point', { timeout: 30_000 })
  await calibrateAction.click()
  await expect(page).toHaveURL(/\/calibration$/)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page).not.toHaveTitle(/500 - Internal Server Error/)
  await expect(page.getByTestId('learn-v2-calibration')).toBeVisible()
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
  await page.getByTestId('learn-v2-schedule-timezone').fill(window.timezone)
  await page.getByTestId('learn-v2-schedule-start').fill(window.date)
  await page.getByTestId(`learn-v2-schedule-day-${window.weekday}`).check()
  await page.getByTestId(`learn-v2-schedule-window-start-${window.weekday}`).fill(window.start)
  await page.getByTestId(`learn-v2-schedule-window-end-${window.weekday}`).fill(window.end)
  await page.getByTestId('learn-v2-create-plan-preview').click()
  await expect(page.getByTestId('learn-v2-study-rhythm')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('learn-v2-study-rhythm')).toContainText(/feasible/i)
  await page.getByTestId('learn-v2-accept-plan').click()

  await expect.poll(async () => {
    if (!/\/sessions\/[^/]+$/.test(page.url())) {
      await page.getByTestId('learn-v2-workspace-next-action').click()
      await page.waitForTimeout(1_000)
    }
    return page.url()
  }, { timeout: 120_000 }).toMatch(/\/sessions\/[^/]+$/)
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
  await page.getByTestId('learn-v2-confidence-4').click()
  await page.getByTestId('learn-v2-submit').click()
  await expect(page.getByTestId('learn-v2-feedback')).toBeVisible({ timeout: 120_000 })
  await page.getByTestId('learn-v2-next-review').click()
  await expect(page.getByTestId('learn-v2-next-review-panel')).toBeVisible()
  await page.getByTestId('learn-v2-complete-leave').click()
  await expect(page).toHaveURL(/\/app\/learn\/[^/]+\?section=plan$/)
  await expect(page.getByTestId('learn-v2-study-rhythm')).toBeVisible()
  await expect(page.getByTestId('learn-v2-plan-accepted')).toBeVisible()
  await expect(page.getByTestId('learn-v2-accept-plan')).toHaveCount(0)
})
