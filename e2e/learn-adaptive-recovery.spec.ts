import { expect, test, type Page } from '@playwright/test'

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
const evidenceRecovery = {
  stale: {
    title: 'Evidence needs refreshing',
    body: 'The selected material changed. Review it before factual study continues. Any response you saved remains available.',
  },
  invalidated: {
    title: 'Evidence was invalidated',
    body: 'The earlier support is no longer usable. Any response you saved remains available.',
  },
} as const

async function visitHarness(page: Page, path: string) {
  try {
    await page.goto(path)
  }
  catch (error) {
    // Nuxt can reload once while compiling the first fixture route in CI.
    if (!(error instanceof Error) || !error.message.includes('net::ERR_ABORTED')) throw error
    await page.goto(path)
  }
  await expect(page.getByTestId('canvas-browser-harness')).toHaveAttribute('data-projection-only', 'true')
  await expect(page.getByTestId('canvas-browser-harness')).toHaveAttribute('data-hydrated', 'true')
}

test.describe('static Canvas projections in real Chromium', () => {
  for (const kind of primitives) {
    test(`${kind} mounts at desktop, tablet, and mobile sizes with safe fallback`, async ({ page }) => {
      test.setTimeout(3 * 60_000)
      await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })
      for (const viewport of viewports) {
        await page.setViewportSize(viewport)
        await visitHarness(page, `/__e2e/canvas-browser-harness?kind=${kind}&state=active`)
        const harness = page.getByTestId('canvas-browser-harness')
        const primitive = harness.getByTestId(`learn-primitive-${kind.replaceAll('_', '-')}`)
        await expect(primitive, `${kind} ${viewport.name}: real renderer`).toBeVisible()
        await expect(harness, `${kind} ${viewport.name}: projection-only transport`).toHaveAttribute('data-projection-only', 'true')
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
          const target = await button.getAttribute('data-testid') ?? await button.textContent()
          await expect.poll(async () => (await button.boundingBox())?.height ?? 0, {
            message: `${kind} ${viewport.name}: target height for ${target}`,
          }).toBeGreaterThanOrEqual(44)
          const box = await button.boundingBox()
          expect(box, `${kind} ${viewport.name}: visible button box`).not.toBeNull()
          expect(box!.x, `${kind} ${viewport.name}: left inset`).toBeGreaterThanOrEqual(0)
          expect(box!.x + box!.width, `${kind} ${viewport.name}: right inset`).toBeLessThanOrEqual(viewport.width + 1)
        }

        const controls = harness.locator('button:not([disabled]):visible, textarea:not([disabled]):visible, input:not([disabled]):visible')
        if (await controls.count() > 1) {
          await expect(async () => {
            await controls.first().focus()
            await expect(controls.first()).toBeFocused()
            await page.keyboard.press('Tab')
            await expect(controls.nth(1), `${kind} ${viewport.name}: keyboard order`).toBeFocused()
          }).toPass({ timeout: 10_000 })
        }
      }

      await visitHarness(page, `/__e2e/canvas-browser-harness?kind=${kind}&state=fallback`)
      const fallback = page.getByTestId('canvas-browser-harness').getByTestId(kind === 'diagnostic_prompt' ? 'learn-diagnostic-fallback' : 'learn-activity-fallback')
      await expect(fallback).toBeVisible()
      expect(await fallback.getAttribute('role')).toMatch(/^(alert|status)$/)
      await expect(page.getByTestId(`learn-primitive-${kind.replaceAll('_', '-')}`)).toHaveCount(0)
      await expect(fallback).toContainText(/cannot be displayed safely|unavailable|could not be displayed safely/i)
    })
  }

  for (const kind of primitives) {
    for (const state of ['stale', 'invalidated'] as const) {
      test(`${kind} presents ${state} recovery at desktop, tablet, and mobile`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' })
        for (const viewport of viewports) {
          await page.setViewportSize(viewport)
          await visitHarness(page, `/__e2e/canvas-browser-harness?kind=${kind}&state=${state}`)
          const harness = page.getByTestId('canvas-browser-harness')
          const recovery = kind === 'diagnostic_prompt'
            ? harness.getByTestId('learn-diagnostic-recovery')
            : harness.getByRole('alert')

          await expect(recovery, `${kind} ${state} ${viewport.name}: recovery`).toBeVisible()
          await expect(recovery).toContainText(evidenceRecovery[state].title)
          await expect(recovery).toContainText(evidenceRecovery[state].body)
          await expect(harness).not.toContainText(/mastery achieved|response scored/i)

          const safeAction = recovery.getByRole('button')
          await expect(safeAction).toHaveCount(1)
          await expect(safeAction).toHaveText('Back to Learn')

          if (kind === 'diagnostic_prompt') {
            // Diagnostics are non-factual: source changes are announced while
            // the learner can still record an unscored starting point.
            await expect(recovery).not.toHaveAttribute('role', 'alert')
            await expect(recovery.getByRole('status')).toContainText(evidenceRecovery[state].body)
            await expect(harness.getByTestId('learn-primitive-diagnostic-prompt')).toBeVisible()
            await expect(harness.getByTestId('learn-diagnostic-response')).toBeEnabled()
          }
          else {
            const testId = `learn-primitive-${kind.replaceAll('_', '-')}`
            await expect(harness.getByTestId(testId)).toHaveCount(0)
            expect(await recovery.getAttribute('role')).toBe('alert')
            await expect(safeAction).toBeFocused()
          }

          const bounds = await harness.evaluate(element => ({
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            viewportWidth: window.innerWidth,
          }))
          expect(bounds.scrollWidth, `${kind} ${state} ${viewport.name}: reflow`).toBeLessThanOrEqual(bounds.clientWidth)
          expect(bounds.clientWidth, `${kind} ${state} ${viewport.name}: viewport`).toBeLessThanOrEqual(bounds.viewportWidth)
          const actionBox = await safeAction.boundingBox()
          expect(actionBox, `${kind} ${state} ${viewport.name}: safe action bounds`).not.toBeNull()
          expect(actionBox!.height, `${kind} ${state} ${viewport.name}: safe action target`).toBeGreaterThanOrEqual(44)
          expect(actionBox!.x, `${kind} ${state} ${viewport.name}: left inset`).toBeGreaterThanOrEqual(0)
          expect(actionBox!.x + actionBox!.width, `${kind} ${state} ${viewport.name}: right inset`).toBeLessThanOrEqual(viewport.width + 1)
        }
      })
    }
  }

  test('blocked, stale, and invalidated recovery actions retain visible keyboard focus in forced colors', async ({ page }) => {
    test.setTimeout(3 * 60_000)
    await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' })

    for (const kind of primitives) {
      for (const state of ['blocked', 'stale', 'invalidated'] as const) {
        for (const viewport of viewports) {
          await page.setViewportSize(viewport)
          await visitHarness(page, `/__e2e/canvas-browser-harness?kind=${kind}&state=${state}`)
          const harness = page.getByTestId('canvas-browser-harness')
          const recovery = kind === 'diagnostic_prompt'
            ? harness.getByTestId('learn-diagnostic-recovery')
            : harness.getByRole('alert')
          const action = recovery.getByRole('button')

          await expect(recovery, `${kind} ${state} ${viewport.name}: recovery`).toBeVisible()
          if (state === 'blocked') {
            await expect(action, `${kind} ${state} ${viewport.name}: recovery action`).toBeFocused()
          }

          // Exercise keyboard navigation on the safe action and establish
          // keyboard modality before inspecting the rendered focus indicator.
          await action.focus()
          await page.keyboard.press('Tab')
          await page.keyboard.press('Shift+Tab')
          await expect(action, `${kind} ${state} ${viewport.name}: keyboard focus`).toBeFocused()
          const focus = await action.evaluate(element => {
            const style = getComputedStyle(element)
            return {
              visibleFocus: element.matches(':focus-visible'),
              outlineStyle: style.outlineStyle,
              outlineWidth: style.outlineWidth,
              outlineColor: style.outlineColor,
              outlineOffset: style.outlineOffset,
            }
          })
          expect(focus.visibleFocus, `${kind} ${state} ${viewport.name}: keyboard-visible focus`).toBe(true)
          expect(focus.outlineStyle, `${kind} ${state} ${viewport.name}: focus outline style`).toBe('solid')
          expect(Number.parseFloat(focus.outlineWidth), `${kind} ${state} ${viewport.name}: focus outline width`).toBeGreaterThanOrEqual(2)
          expect(focus.outlineColor, `${kind} ${state} ${viewport.name}: focus outline color`).not.toBe('rgba(0, 0, 0, 0)')
          expect(Number.parseFloat(focus.outlineOffset), `${kind} ${state} ${viewport.name}: focus outline offset`).toBeGreaterThanOrEqual(1)
        }
      }
    }
  })

  test('ready, completed, preparing, and blocked projections stay distinguishable', async ({ page }) => {
    test.setTimeout(3 * 60_000)
    for (const kind of ['cited_explanation', 'worked_example', 'independent_application', 'source_comparison'] as const) {
      await visitHarness(page, `/__e2e/canvas-browser-harness?kind=${kind}&state=ready`)
      await expect(page.getByTestId(`learn-primitive-${kind.replaceAll('_', '-')}-ready`)).toBeVisible()
      await visitHarness(page, `/__e2e/canvas-browser-harness?kind=${kind}&state=completed`)
      await expect(page.getByTestId('learn-canvas-status')).toContainText('Response scored')
      await visitHarness(page, `/__e2e/canvas-browser-harness?kind=${kind}&state=preparing`)
      await expect(page.getByTestId('learn-activity-fallback')).toHaveAttribute('role', 'status')
      await visitHarness(page, `/__e2e/canvas-browser-harness?kind=${kind}&state=blocked`)
      await expect(page.getByTestId('learn-activity-fallback')).toHaveAttribute('role', 'alert')
    }
    await visitHarness(page, '/__e2e/canvas-browser-harness?kind=diagnostic_prompt&state=completed')
    await expect(page.getByTestId('learn-diagnostic-saved')).toContainText('A saved starting point.')
    await visitHarness(page, '/__e2e/canvas-browser-harness?kind=reflection_next_move&state=completed')
    await expect(page.getByTestId('learn-reflection-completed')).toContainText('Next move accepted')
  })

  for (const kind of primitives) {
    test(`${kind} blocked recovery replaces the activity with one focused safe action`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await visitHarness(page, `/__e2e/canvas-browser-harness?kind=${kind}&state=blocked`)
      const harness = page.getByTestId('canvas-browser-harness')
      const recovery = harness.getByRole('alert')
      await expect(recovery).toBeVisible()
      await expect(recovery).toContainText(/blocked|unavailable|needs attention/i)
      await expect(harness.getByTestId(`learn-primitive-${kind.replaceAll('_', '-')}`)).toHaveCount(0)
      const action = recovery.getByRole('button')
      await expect(action).toHaveCount(1)
      await expect(action).toHaveText(/Back to Learn|Continue safely/)
      await expect(action).toBeFocused()
      await expect(harness).not.toContainText(/mastery achieved|response scored/i)
      await action.press('Enter')
      await expect(harness.getByRole('status').filter({ hasText: 'Back to Learn was requested.' })).toBeVisible()
    })
  }

  test('a diagnostic draft survives stale, invalidated, and blocked projections plus a narrow viewport resize', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await visitHarness(page, '/__e2e/canvas-browser-harness?kind=diagnostic_prompt&state=active')
    const draft = 'My starting point is still unfinished.'
    await page.getByTestId('learn-diagnostic-response').fill(draft)
    await expect.poll(() => page.evaluate(value => Object.values(sessionStorage).some(entry => entry.includes(value)), draft)).toBe(true)
    await page.setViewportSize({ width: 375, height: 420 })
    await expect(page.getByTestId('learn-diagnostic-response')).toHaveValue(draft)
    for (const state of ['stale', 'invalidated'] as const) {
      await visitHarness(page, `/__e2e/canvas-browser-harness?kind=diagnostic_prompt&state=${state}`)
      await expect(page.getByTestId('learn-diagnostic-response')).toHaveValue(draft)
      await expect(page.getByTestId('learn-diagnostic-recovery')).toContainText(evidenceRecovery[state].title)
    }
    await visitHarness(page, '/__e2e/canvas-browser-harness?kind=diagnostic_prompt&state=blocked')
    await expect(page.getByTestId('learn-diagnostic-response')).toHaveCount(0)
    await expect(page.getByTestId('learn-diagnostic-recovery')).toHaveAttribute('role', 'alert')
    await expect(page.getByTestId('learn-diagnostic-recovery-action')).toBeFocused()
    await visitHarness(page, '/__e2e/canvas-browser-harness?kind=diagnostic_prompt&state=active')
    await expect(page.getByTestId('learn-diagnostic-response')).toHaveValue(draft)
  })

  test('factual response and artifact drafts remain available through stale and invalidated recovery', async ({ page }) => {
    const response = 'An unfinished independent response.'
    await visitHarness(page, '/__e2e/canvas-browser-harness?kind=independent_application&state=active')
    await page.getByTestId('learn-canvas-response').fill(response)
    await expect.poll(() => page.evaluate(value => Object.values(sessionStorage).some(entry => entry.includes(value)), response)).toBe(true)

    for (const state of ['stale', 'invalidated'] as const) {
      await visitHarness(page, `/__e2e/canvas-browser-harness?kind=independent_application&state=${state}`)
      await expect(page.getByTestId('learn-canvas-draft-fallback')).toContainText('unfinished response remains on this device')
      await visitHarness(page, '/__e2e/canvas-browser-harness?kind=independent_application&state=active')
      await expect(page.getByTestId('learn-canvas-response')).toHaveValue(response)
    }

    const title = 'A saved-on-device plan'
    const content = 'Keep this unfinished artifact available.'
    await visitHarness(page, '/__e2e/canvas-browser-harness?kind=artifact_workspace&state=active')
    await page.getByTestId('learn-artifact-title').fill(title)
    await page.getByTestId('learn-artifact-content').fill(content)
    await expect.poll(() => page.evaluate(value => Object.values(sessionStorage).some(entry => entry.includes(value)), content)).toBe(true)

    for (const state of ['stale', 'invalidated'] as const) {
      await visitHarness(page, `/__e2e/canvas-browser-harness?kind=artifact_workspace&state=${state}`)
      await expect(page.getByRole('alert')).toContainText('unfinished artifact remains on this device')
      await expect(page.getByRole('alert')).toContainText(evidenceRecovery[state].title)
      await visitHarness(page, '/__e2e/canvas-browser-harness?kind=artifact_workspace&state=active')
      await expect(page.getByTestId('learn-artifact-title')).toHaveValue(title)
      await expect(page.getByTestId('learn-artifact-content')).toHaveValue(content)
    }
  })

  test('an independent response draft stays local and submission is disabled while Chromium is offline', async ({ page, context }) => {
    const response = 'An unfinished response saved before disconnecting.'
    await visitHarness(page, '/__e2e/canvas-browser-harness?kind=independent_application&state=active')
    const responseField = page.getByTestId('learn-canvas-response')
    const submit = page.getByTestId('learn-canvas-submit')

    await responseField.fill(response)
    await page.getByTestId('learn-canvas-confidence-4').check()
    await expect.poll(() => page.evaluate(value => Object.values(sessionStorage).some(entry => entry.includes(value)), response)).toBe(true)
    await expect(submit).toBeEnabled()

    await context.setOffline(true)
    await expect(page.getByRole('status').filter({ hasText: 'A connection is required' })).toBeVisible()
    await expect(responseField).toHaveValue(response)
    await expect(submit).toBeDisabled()

    await context.setOffline(false)
    await expect(page.getByRole('status').filter({ hasText: 'A connection is required' })).toHaveCount(0)
    await expect(responseField).toHaveValue(response)
    await expect(submit).toBeEnabled()
  })

  for (const kind of primitives) {
    test(`${kind} focuses recovery when returning from a hidden history view`, async ({ page }) => {
      await visitHarness(page, `/__e2e/canvas-browser-harness?kind=${kind}&state=blocked&hidden=1`)
      await expect(page.getByTestId('learn-adaptive-canvas-frame')).toBeHidden()
      await page.getByTestId('show-current-activity').click()
      const recovery = page.getByTestId('canvas-browser-harness').getByRole('alert')
      await expect(recovery).toBeVisible()
      await expect(recovery.getByRole('button')).toBeFocused()
    })
  }
})

// The disposable E2E account has local Adaptive access, but this thread link
// contains an invalid ID. Exercise the real route's unavailable recovery boundary.
test('an invalid learning thread link offers keyboard-operable recovery at each viewport', async ({ page, request }) => {
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

    const boundary = page.getByTestId('learn-adaptive-thread-unavailable')
    await expect(boundary, `${viewport.name}: unavailable boundary`).toBeVisible()
    await expect(boundary.getByRole('status')).toHaveText('This learning thread is unavailable.')
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
    await expect(page.getByTestId('learn-adaptive-thread-unavailable')).toHaveCount(0)
  }
})
