import { expect, test } from '@playwright/test'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserDependencyIncludes } from './browser-layer/dependencies'
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

test('cold client modules stay valid when a lazy route imports more dependencies', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'budds-browser-deps-'))
  let server: Awaited<ReturnType<typeof createServer>> | undefined
  try {
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir')
    await Promise.all([
      writeFile(join(root, 'index.html'), '<script type="module" src="/main.js"></script>'),
      writeFile(join(root, 'main.js'), "import { motion } from 'motion-v'; window.fixtureReady = Boolean(motion)"),
      writeFile(join(root, 'late.js'), [
        "import * as convexVue from '@convex-vue/core'",
        "import { v } from 'convex/values'",
        "import { queryGeneric } from 'convex/server'",
        "import { twMerge } from 'tailwind-merge'",
        'export const ready = Boolean(convexVue && v && queryGeneric && twMerge)',
      ].join('\n')),
    ])
    server = await createServer({
      root,
      configFile: false,
      cacheDir: join(root, '.vite'),
      logLevel: 'error',
      optimizeDeps: { include: browserDependencyIncludes },
      server: { host: '127.0.0.1', port: 0 },
    })
    await server.listen()
    const url = server.resolvedUrls?.local[0]
    if (!url) throw new Error('Disposable Vite server did not expose a loopback URL')
    const [initialDependency] = await Promise.all([
      page.waitForRequest(resource => resource.url().includes('motion-v.js?')),
      page.goto(url),
    ])
    await page.waitForFunction(() => Reflect.get(window, 'fixtureReady'))
    const ready = await page.evaluate(async modulePath => (await import(modulePath)).ready, '/late.js')
    expect(ready).toBe(true)
    const response = await request.get(initialDependency.url())
    expect(response.status()).toBe(200)
  }
  finally {
    await server?.close()
    await rm(root, { recursive: true, force: true })
  }
})
