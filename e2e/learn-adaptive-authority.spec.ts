import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

const token = process.env.BUDDS_E2E_AUTH_TOKEN ?? 'e2e-local-token-please-do-not-use-outside-tests'

async function tabTo(page: Page, control: Locator) {
  if (await control.evaluate(element => element === document.activeElement)) await page.keyboard.press('Tab')
  const unfocusedShadow = await control.evaluate(element => getComputedStyle(element).boxShadow)
  for (let step = 0; step < 80; step++) {
    if (await control.evaluate(element => element === document.activeElement)) {
      const focus = await control.evaluate(element => {
        const style = getComputedStyle(element)
        return { visible: element.matches(':focus-visible'), outline: style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0 && style.outlineColor !== 'rgba(0, 0, 0, 0)', shadow: style.boxShadow }
      })
      expect(focus.visible).toBe(true)
      expect(focus.outline || focus.shadow !== 'none' && focus.shadow !== unfocusedShadow).toBe(true)
      return
    }
    await page.keyboard.press('Tab')
  }
  throw new Error('Learning control was not reachable through keyboard traversal')
}

async function openLearningHome(page: Page, request: APIRequestContext) {
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
  await expect(page.locator('[data-owner-ready]')).toHaveAttribute('data-owner-ready', 'true')
  await expect(page.getByRole('main')).toHaveCount(1)
}

async function startRoutedDiagnostic(page: Page, request: APIRequestContext, keyboardOnly = false) {
  async function activate(control: Locator) {
    if (!keyboardOnly) return control.click()
    await tabTo(page, control)
    await page.keyboard.press('Enter')
  }
  async function enter(control: Locator, value: string) {
    if (!keyboardOnly) return control.fill(value)
    await tabTo(page, control)
    await page.keyboard.insertText(value)
  }
  await openLearningHome(page, request)
  await enter(page.getByTestId('learn-adaptive-need'), 'Explain why an orbiting satellite does not fall straight down.')
  await activate(page.getByTestId('learn-adaptive-start'))
  await expect(page.getByTestId('learn-initial-decision')).toBeVisible({ timeout: 30_000 })
  if (await page.getByTestId('learn-clarification-skip').isVisible()) await activate(page.getByTestId('learn-clarification-skip'))
  await expect(page.getByTestId('learn-adaptive-open-diagnostic')).toBeVisible()
  await activate(page.getByTestId('learn-adaptive-open-diagnostic'))
  await expect(page).toHaveURL(/\/app\/learn\/thread\/[^/]+$/)
  await expect(page.getByTestId('learn-diagnostic-canvas')).toBeVisible()
  await expect(page.getByRole('main')).toHaveCount(1)
  await activate(page.getByTestId('learn-diagnostic-start'))
  const response = 'The satellite keeps falling while its sideways velocity carries it around Earth.'
  await enter(page.getByTestId('learn-diagnostic-response'), response)
  if (keyboardOnly) {
    await activate(page.getByTestId('learn-why-toggle'))
    await expect(page.getByTestId('learn-why-toggle')).toHaveAttribute('aria-expanded', 'true')
    await activate(page.getByTestId('learn-override-time_25'))
    await expect(page.getByTestId('learn-fixed-next-plan')).toContainText('Continue with 25 minutes')
    await expect(page.getByTestId('learn-override-time_25')).toBeFocused()
    await expect(page.getByTestId('learn-diagnostic-response')).toHaveValue(response)
  }
  return { threadUrl: page.url(), response }
}

async function saveRoutedDiagnostic(page: Page, request: APIRequestContext, keyboardOnly = false) {
  const result = await startRoutedDiagnostic(page, request, keyboardOnly)
  if (keyboardOnly) {
    await tabTo(page, page.getByTestId('learn-diagnostic-submit'))
    await page.keyboard.press('Enter')
  }
  else await page.getByTestId('learn-diagnostic-submit').click()
  await expect(page.getByTestId('learn-diagnostic-saved')).toContainText(result.response)
  return result
}

test('Home primary action and time selector meet 44px targets through responsive reflow', async ({ page, request }) => {
  test.setTimeout(3 * 60_000)
  await openLearningHome(page, request)
  for (const viewport of [{ width: 1280, height: 800 }, { width: 768, height: 1024 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(viewport)
    for (const id of ['learn-adaptive-start', 'learn-adaptive-time']) {
      const bounds = await page.getByTestId(id).boundingBox()
      expect(bounds, `${id}: visible target`).not.toBeNull()
      expect(bounds!.height, `${id}: target height at ${viewport.width}`).toBeGreaterThanOrEqual(44)
      expect(bounds!.width, `${id}: target width at ${viewport.width}`).toBeGreaterThanOrEqual(44)
    }
  }
})

test('Home source controls retain non-color labels and minimum targets', async ({ page, request }) => {
  test.setTimeout(3 * 60_000)
  await openLearningHome(page, request)
  await page.setViewportSize({ width: 375, height: 667 })
  for (const source of [
    { name: 'Folder', fields: ['learn-adaptive-folder'] },
    { name: 'Document', fields: ['learn-adaptive-document-folder', 'learn-adaptive-document'] },
    { name: 'URL', fields: ['learn-adaptive-url'] },
    { name: 'Pasted', fields: ['learn-adaptive-paste'] },
  ]) {
    const choice = page.getByRole('radio', { name: new RegExp(`^${source.name}$`, 'i') })
    await choice.check()
    await expect(choice).toBeChecked()
    for (const id of source.fields) {
      const field = page.getByTestId(id)
      await expect(field).toBeVisible()
      await expect(field).toHaveAccessibleName(/.+/)
      const bounds = await field.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.height, id).toBeGreaterThanOrEqual(44)
      expect(bounds!.width, id).toBeGreaterThanOrEqual(44)
    }
  }
  await page.getByRole('radio', { name: /^url$/i }).check()
  const url = page.getByTestId('learn-adaptive-url')
  await url.fill('https://example.com/learning-notes')
  const need = page.getByTestId('learn-adaptive-need')
  await need.fill('Understand the selected notes.')
  for (const viewport of [{ width: 768, height: 1024 }, { width: 667, height: 375 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(viewport)
    await expect(page.getByRole('radio', { name: /^url$/i })).toBeChecked()
    await expect(url).toHaveValue('https://example.com/learning-notes')
    await expect(need).toHaveValue('Understand the selected notes.')
  }
})

test('reduced motion suppresses Learning drawer animation without losing the response', async ({ page, request }) => {
  test.setTimeout(4 * 60_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { response } = await startRoutedDiagnostic(page, request)
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  for (const kind of ['memory', 'evidence']) {
    await page.getByTestId(`learn-${kind}-open`).click()
    const drawer = page.getByTestId(`learn-${kind}-drawer`)
    await expect(drawer).toBeVisible()
    const motion = await drawer.evaluate(element => {
      const style = getComputedStyle(element)
      return { animation: style.animationDuration, transition: style.transitionDuration }
    })
    expect(motion.animation.split(',').every(value => Number.parseFloat(value) === 0)).toBe(true)
    expect(motion.transition.split(',').every(value => Number.parseFloat(value) === 0)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(page.getByTestId('learn-diagnostic-response')).toHaveValue(response)
  }
})

test('forced colors retain a visible keyboard focus outline on Home controls', async ({ page, request }) => {
  test.setTimeout(3 * 60_000)
  await page.emulateMedia({ forcedColors: 'active' })
  await openLearningHome(page, request)
  expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true)
  for (const id of ['learn-adaptive-need', 'learn-adaptive-time', 'learn-adaptive-start']) {
    const control = page.getByTestId(id)
    await tabTo(page, control)
    const outline = await control.evaluate(element => {
      const style = getComputedStyle(element)
      return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) }
    })
    expect(outline.style).not.toBe('none')
    expect(outline.width).toBeGreaterThanOrEqual(2)
  }
})

test('Learning drawer close controls meet minimum touch targets', async ({ page, request }) => {
  test.setTimeout(4 * 60_000)
  const { response } = await startRoutedDiagnostic(page, request)
  await page.setViewportSize({ width: 375, height: 667 })
  for (const kind of ['memory', 'evidence']) {
    await page.getByTestId(`learn-${kind}-open`).click()
    const drawer = page.getByTestId(`learn-${kind}-drawer`)
    await expect(drawer).toBeVisible()
    const closeControls = drawer.getByRole('button', { name: /^Close/ })
    await expect(closeControls).toHaveCount(2)
    for (const close of await closeControls.all()) {
      const bounds = await close.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.height).toBeGreaterThanOrEqual(44)
      expect(bounds!.width).toBeGreaterThanOrEqual(44)
    }
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(page.getByTestId('learn-diagnostic-response')).toHaveValue(response)
  }
})

test('active response and its scroll anchor survive reflow and rotation before saving', async ({ page, request }) => {
  test.setTimeout(4 * 60_000)
  const { threadUrl, response } = await startRoutedDiagnostic(page, request)
  const field = page.getByTestId('learn-diagnostic-response')
  await field.scrollIntoViewIfNeeded()
  await field.focus()
  // Observe the same visible field across resizes; do not scroll it back into place afterward.
  for (const viewport of [{ width: 1280, height: 800 }, { width: 768, height: 1024 }, { width: 375, height: 667 }, { width: 667, height: 375 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(viewport)
    await expect(field).toHaveValue(response)
    await expect(page).toHaveURL(threadUrl)
    await expect.poll(async () => {
      const anchor = await field.boundingBox()
      return Boolean(anchor && anchor.y >= 0 && anchor.y + anchor.height <= viewport.height + 1
        && anchor.x >= 0 && anchor.x + anchor.width <= viewport.width + 1)
    }, { message: `Active response remains the visible anchor at ${viewport.width}x${viewport.height}` }).toBe(true)
    await expect(field).toBeFocused()
  }
  await page.getByTestId('learn-diagnostic-submit').click()
  await expect(page.getByTestId('learn-diagnostic-saved')).toContainText(response)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('learn-diagnostic-saved')).toContainText(response)
})

test('simulated touch keyboard viewport keeps the active response visible and recoverable', async ({ browser, request }) => {
  test.setTimeout(4 * 60_000)
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  try {
    const { response } = await startRoutedDiagnostic(page, request)
    const field = page.getByTestId('learn-diagnostic-response')
    await field.focus()
    // Instrument the external browser viewport, not an application helper. This is not physical-device evidence.
    await page.evaluate(() => {
      Object.defineProperty(window.visualViewport!, 'height', { configurable: true, get: () => 367 })
      window.visualViewport!.dispatchEvent(new Event('resize'))
    })
    await expect(page.locator('html')).toHaveAttribute('data-keyboard-open', 'true')
    await expect.poll(async () => {
      const bounds = await field.boundingBox()
      return bounds ? bounds.y + bounds.height : Infinity
    }).toBeLessThanOrEqual(351)
    expect((await field.boundingBox())!.y).toBeGreaterThanOrEqual(16)
    await expect(field).toHaveValue(response)
    const submit = page.getByTestId('learn-diagnostic-submit')
    await tabTo(page, submit)
    const action = await submit.boundingBox()
    expect(action).not.toBeNull()
    expect(action!.y).toBeGreaterThanOrEqual(0)
    expect(action!.y + action!.height).toBeLessThanOrEqual(367)
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('learn-diagnostic-saved')).toContainText(response)
    await page.evaluate(() => {
      delete (window.visualViewport as unknown as { height?: number }).height
      window.visualViewport!.dispatchEvent(new Event('resize'))
    })
    await expect(page.locator('html')).toHaveAttribute('data-keyboard-open', 'false')
    await expect(page.getByTestId('learn-diagnostic-saved')).toContainText(response)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('learn-diagnostic-saved')).toContainText(response)
  }
  finally { await context.close() }
})

test('200% rendered zoom reflows Home without losing its draft or source', async ({ page, request }) => {
  test.setTimeout(3 * 60_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openLearningHome(page, request)
  const need = page.getByTestId('learn-adaptive-need')
  await need.fill('Retain this draft at twice the rendered scale.')
  await page.getByRole('radio', { name: /^url$/i }).check()
  const url = page.getByTestId('learn-adaptive-url')
  await url.fill('https://example.com/learning-notes')
  const unzoomedNeed = await need.boundingBox()
  expect(unzoomedNeed).not.toBeNull()
  // CSS zoom exercises doubled rendered text/control dimensions and layout reflow; it is not physical-device proof.
  await page.evaluate(() => { document.documentElement.style.zoom = '200%' })
  await expect(need).toHaveValue('Retain this draft at twice the rendered scale.')
  await expect(url).toHaveValue('https://example.com/learning-notes')
  await expect(page.getByRole('radio', { name: /^url$/i })).toBeChecked()
  expect((await need.boundingBox())!.height).toBeGreaterThanOrEqual(unzoomedNeed!.height * 2 - 1)
  const home = page.getByTestId('learn-adaptive-home')
  expect(await home.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  for (const control of [need, url, page.getByTestId('learn-adaptive-start')]) {
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1281)
  }
})

test('routed diagnostic persists the learner response through the disposable backend', async ({ page, request }) => {
  test.setTimeout(4 * 60_000)
  const { response } = await saveRoutedDiagnostic(page, request)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('learn-diagnostic-saved')).toContainText(response)
})

test('keyboard-only Home to Thread journey saves a response and restores drawer focus', async ({ page, request }) => {
  test.setTimeout(5 * 60_000)
  const { response } = await saveRoutedDiagnostic(page, request, true)
  for (const drawer of [
    { trigger: 'learn-memory-open', content: 'learn-memory-drawer', name: 'Learning memory' },
    { trigger: 'learn-evidence-open', content: 'learn-evidence-drawer', name: 'Evidence' },
  ]) {
    const trigger = page.getByTestId(drawer.trigger)
    await tabTo(page, trigger)
    await page.keyboard.press('Enter')
    const dialog = page.getByTestId(drawer.content)
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAccessibleName(drawer.name)
    for (let step = 0; step < 16; step++) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    await expect(page.getByTestId('learn-diagnostic-saved')).toContainText(response)
  }
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
