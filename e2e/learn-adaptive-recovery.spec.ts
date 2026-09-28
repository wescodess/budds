import { expect, test } from '@playwright/test'

const primitives = [
  'cited_explanation',
  'diagnostic_prompt',
  'worked_example',
  'independent_application',
  'source_comparison',
  'artifact_workspace',
  'reflection_next_move',
] as const
const token = process.env.BUDDS_E2E_AUTH_TOKEN ?? 'e2e-local-token-please-do-not-use-outside-tests'
const baseUrl = process.env.BUDDS_E2E_BASE_URL ?? 'http://127.0.0.1:3102'
const viewports = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 375, height: 667 },
] as const

test.describe('static Canvas projections in real Chromium', () => {
  for (const kind of primitives) {
    test(`${kind} mounts at desktop, tablet, and mobile sizes with safe fallback`, async ({ page }) => {
      test.setTimeout(3 * 60_000)
      await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })
      for (const viewport of viewports) {
        await page.setViewportSize(viewport)
        await page.goto(`/__e2e/canvas-browser-harness?kind=${kind}&state=active`)
        const harness = page.getByTestId('canvas-browser-harness')
        const primitive = harness.getByTestId(`learn-primitive-${kind.replaceAll('_', '-')}`)
        await expect(primitive, `${kind} ${viewport.name}: real renderer`).toBeVisible()
        await expect.poll(() => page.evaluate(() => Reflect.get(globalThis, '__buddsCanvasProjectionOnly')), { message: `${kind} ${viewport.name}: projection-only transport` }).toBe(true)
        await expect(harness.getByTestId('learn-activity-fallback')).toHaveCount(0)
        await expect(harness.locator('h1')).toHaveText('Canvas browser fixture')
        await expect(page.getByRole('main')).toHaveCount(1)
        await expect(harness).not.toContainText('Mastery achieved')
        const unlabeledFields = await primitive.locator('input, textarea').evaluateAll(fields => fields
          .filter(field => !(field as HTMLInputElement).labels?.length && !field.getAttribute('aria-label') && !field.getAttribute('aria-labelledby'))
          .map(field => field.outerHTML))
        expect(unlabeledFields, `${kind} ${viewport.name}: field labels`).toEqual([])

        const metrics = await harness.evaluate(element => ({
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          viewportWidth: window.innerWidth,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          forcedColors: matchMedia('(forced-colors: active)').matches,
        }))
        expect(metrics.scrollWidth, `${kind} ${viewport.name}: reflow`).toBeLessThanOrEqual(metrics.clientWidth)
        expect(metrics.clientWidth, `${kind} ${viewport.name}: inset`).toBeLessThanOrEqual(metrics.viewportWidth)
        expect(metrics.reducedMotion).toBe(true)
        expect(metrics.forcedColors).toBe(true)

        for (const button of await harness.locator('button:visible').all()) {
          const box = await button.boundingBox()
          expect(box, `${kind} ${viewport.name}: visible button box`).not.toBeNull()
          expect(box!.height, `${kind} ${viewport.name}: target height`).toBeGreaterThanOrEqual(44)
          expect(box!.x, `${kind} ${viewport.name}: left inset`).toBeGreaterThanOrEqual(0)
          expect(box!.x + box!.width, `${kind} ${viewport.name}: right inset`).toBeLessThanOrEqual(viewport.width + 1)
        }

        const controls = harness.locator('button:not([disabled]):visible, textarea:not([disabled]):visible, input:not([disabled]):visible')
        if (await controls.count() > 1) {
          await controls.first().focus()
          await expect(controls.first()).toBeFocused()
          await page.keyboard.press('Tab')
          await expect(controls.nth(1), `${kind} ${viewport.name}: keyboard order`).toBeFocused()
        }
      }

      await page.goto(`/__e2e/canvas-browser-harness?kind=${kind}&state=fallback`)
      const fallback = page.getByTestId('canvas-browser-harness').getByTestId(kind === 'diagnostic_prompt' ? 'learn-diagnostic-fallback' : 'learn-activity-fallback')
      await expect(fallback).toBeVisible()
      expect(await fallback.getAttribute('role')).toMatch(/^(alert|status)$/)
      await expect(page.getByTestId(`learn-primitive-${kind.replaceAll('_', '-')}`)).toHaveCount(0)
      await expect(fallback).toContainText(/cannot be displayed safely|unavailable|could not be displayed safely/i)
    })
  }

  test('ready, completed, preparing, and blocked projections stay distinguishable', async ({ page }) => {
    test.setTimeout(3 * 60_000)
    for (const kind of ['cited_explanation', 'worked_example', 'independent_application', 'source_comparison'] as const) {
      await page.goto(`/__e2e/canvas-browser-harness?kind=${kind}&state=ready`)
      await expect(page.getByTestId(`learn-primitive-${kind.replaceAll('_', '-')}-ready`)).toBeVisible()
      await page.goto(`/__e2e/canvas-browser-harness?kind=${kind}&state=completed`)
      await expect(page.getByTestId('learn-canvas-status')).toContainText('Response scored')
      await page.goto(`/__e2e/canvas-browser-harness?kind=${kind}&state=preparing`)
      await expect(page.getByTestId('learn-activity-fallback')).toHaveAttribute('role', 'status')
      await page.goto(`/__e2e/canvas-browser-harness?kind=${kind}&state=blocked`)
      await expect(page.getByTestId('learn-activity-fallback')).toHaveAttribute('role', 'alert')
    }
    await page.goto('/__e2e/canvas-browser-harness?kind=diagnostic_prompt&state=completed')
    await expect(page.getByTestId('learn-diagnostic-saved')).toContainText('A saved starting point.')
    await page.goto('/__e2e/canvas-browser-harness?kind=reflection_next_move&state=completed')
    await expect(page.getByTestId('learn-reflection-completed')).toContainText('Next move accepted')
  })
})

// The disposable E2E account has no adaptive entitlement. This exercises the
// real route's denied recovery boundary, without manufacturing a Canvas state.
test('an unavailable learning thread offers keyboard-operable recovery at each viewport', async ({ page, request }) => {
  test.setTimeout(3 * 60_000)
  const identity = {
    email: `adaptive-recovery-${Date.now()}@e2e.budds.invalid`,
    password: 'disposable-e2e-password',
    name: 'Adaptive Recovery Browser Test',
  }
  const bootstrap = await request.post('/api/e2e/session', {
    headers: { 'x-budds-e2e-token': token },
    data: identity,
  })
  expect(bootstrap.ok()).toBeTruthy()
  const cookies = bootstrap.headersArray().filter(header => header.name.toLowerCase() === 'set-cookie')
  expect(cookies.length).toBeGreaterThan(0)
  for (const cookie of cookies) {
    const [nameValue] = cookie.value.split(';')
    const separator = nameValue.indexOf('=')
    expect(separator).toBeGreaterThan(0)
    await page.context().addCookies([{
      name: nameValue.slice(0, separator),
      value: nameValue.slice(separator + 1),
      url: baseUrl,
    }])
  }

  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })
    await page.goto('/app/learn/thread/unavailable-e2e-thread')

    const boundary = page.getByTestId('learn-adaptive-thread-denied')
    await expect(boundary, `${viewport.name}: access boundary`).toBeVisible()
    await expect(boundary.getByRole('status')).toHaveText('This learning thread is not available for this account.')
    await expect(page.getByTestId('learn-adaptive-canvas-frame')).toHaveCount(0)

    const recovery = boundary.getByRole('link', { name: 'Back to Learn' })
    await expect(recovery).toHaveAttribute('href', '/app/learn')
    const box = await recovery.boundingBox()
    expect(box, `${viewport.name}: recovery target has a box`).not.toBeNull()
    expect(box!.height, `${viewport.name}: recovery target height`).toBeGreaterThanOrEqual(44)
    expect(box!.x, `${viewport.name}: target starts within viewport`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${viewport.name}: target ends within viewport`).toBeLessThanOrEqual(viewport.width)

    const main = page.getByTestId('learn-adaptive-thread-route')
    const dimensions = await main.evaluate(element => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }))
    expect(dimensions.scrollWidth, `${viewport.name}: thread route reflows`).toBeLessThanOrEqual(dimensions.clientWidth)

    await recovery.focus()
    await expect(recovery).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/app\/learn(?:\?.*)?$/)
    await expect(page.getByTestId('learn-adaptive-thread-denied')).toHaveCount(0)
  }
})
