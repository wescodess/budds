import { execFile as execFileCallback, spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from '@playwright/test'
import { acquireCaptureStackLock, captureIdentity, compareFloor, publishCaptureOutput, readComparisonFloor, resetCaptureOutput, selectCaptureBaseUrl, stopCaptureStack, validateSurface, violationId } from './design-capture-lib.mjs'
import { checkPage } from './design-capture-checks.mjs'

const execFile = promisify(execFileCallback)
const root = process.cwd()
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`)
const message = error => error instanceof Error ? error.message : String(error)
let stack
let releaseStackLock
let stackFailure
let browser
let interrupted = false

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = true
  void browser?.close()
  void stopStack().catch(error => { stackFailure = message(error) })
})

async function startStack() {
  const baseUrl = await selectCaptureBaseUrl(process.env.BUDDS_E2E_BASE_URL)
  releaseStackLock = await acquireCaptureStackLock()
  stack = spawn(process.execPath, ['scripts/e2e-stack.mjs'], {
    cwd: root,
    env: { ...process.env, BUDDS_E2E_BASE_URL: baseUrl.origin, BUDDS_E2E_REAL_ADAPTIVE_CANVAS: 'false', BUDDS_E2E_OWNED_GROUPS_FILE: releaseStackLock.groupsFile },
    stdio: 'inherit',
    detached: true,
  })
  releaseStackLock.recordStack(stack.pid)
  stack.once('error', error => { stackFailure = message(error) })
  stack.once('exit', (code, signal) => { stackFailure = `Disposable E2E stack exited (${signal || code})` })
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (interrupted || stackFailure) throw new Error(stackFailure || 'Capture interrupted')
    const ready = await fetch(baseUrl, { signal: AbortSignal.timeout(1000) }).then(response => response.ok).catch(() => false)
    if (interrupted || stackFailure) throw new Error(stackFailure || 'Capture interrupted')
    releaseStackLock.readGroups()
    if (ready) return baseUrl.origin
    await delay(250)
  }
  throw new Error('Timed out waiting for the disposable E2E stack')
}

async function stopStack() {
  await stopCaptureStack(stack, releaseStackLock)
}

async function capturePage(surface, identity, entry, baseUrl, output) {
  const context = await browser.newContext({ viewport: identity.viewport, deviceScaleFactor: 1, colorScheme: identity.theme, reducedMotion: 'reduce', locale: 'en-CA', timezoneId: 'UTC', serviceWorkers: 'block' })
  try {
    await context.addInitScript(theme => {
      try { localStorage.setItem('budds-color-mode', theme) } catch { /* File URLs can deny storage. */ }
      const apply = () => {
        if (!document.documentElement) return false
        document.documentElement.classList.toggle('dark', theme === 'dark')
        document.documentElement.classList.toggle('light', theme === 'light')
        document.documentElement.style.colorScheme = theme
        const style = document.createElement('style')
        style.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }'
        document.documentElement.append(style)
        return true
      }
      if (!apply()) {
        const observer = new MutationObserver(() => { if (apply()) observer.disconnect() })
        observer.observe(document, { childList: true })
      }
    }, identity.theme)
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    const errors = []
    page.on('pageerror', error => errors.push(message(error)))
    page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`))
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`) })
    if (surface.kind === 'html') await page.route(/^https?:/u, route => route.abort('blockedbyclient'))
    const url = surface.kind === 'routes' ? new URL(entry.path, baseUrl).href : pathToFileURL(resolve(root, surface.file)).href
    try { await page.goto(url, { waitUntil: 'domcontentloaded' }) }
    catch (error) {
      if (surface.kind !== 'routes' || !message(error).includes('net::ERR_ABORTED')) throw error
      errors.length = 0
      await page.goto(url, { waitUntil: 'domcontentloaded' })
    }
    if (page.url() !== url) throw new Error(`Unexpected navigation: ${page.url()} (expected ${url})`)
    await page.locator(surface.readySelector).waitFor({ state: 'visible' })
    const content = page.locator(surface.contentSelector)
    if (await content.count() !== 1) throw new Error('contentSelector must match exactly one element')
    await content.waitFor({ state: 'visible' })
    if (!(await content.innerText()).trim()) throw new Error('Main content is empty')
    await page.evaluate(async requiredFonts => {
      for (const family of requiredFonts) {
        const loaded = await document.fonts.load(`14px "${family}"`)
        if (!loaded.length) throw new Error(`Required font was not declared: ${family}`)
      }
      await document.fonts.ready
      for (const font of document.fonts) if (font.status === 'error') throw new Error(`Font failed: ${font.family}`)
    }, surface.requiredFonts)
    await page.waitForLoadState('networkidle')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    if (errors.length) throw new Error(errors.join('\n'))
    const rendering = await page.evaluate(() => ({
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      fontFamily: getComputedStyle(document.body).fontFamily,
      fonts: [...document.fonts].filter(font => font.status === 'loaded').map(font => ({ family: font.family, weight: font.weight })),
      devicePixelRatio: devicePixelRatio,
    }))
    if (rendering.theme !== identity.theme || rendering.colorScheme !== identity.theme) throw new Error(`Theme failed to resolve to ${identity.theme}`)
    await page.evaluate(() => window.scrollTo(0, 0))
    const stem = `${identity.kind}--${identity.state}--${identity.theme}--${identity.viewport.width}x${identity.viewport.height}`
    const file = `${stem}.png`
    const cropFile = `${stem}--content.png`
    await page.screenshot({ path: join(output, file), fullPage: true, animations: 'disabled', scale: 'css' })
    await content.screenshot({ path: join(output, cropFile), animations: 'disabled', scale: 'css' })
    const checks = await checkPage(page, surface)
    if (errors.length) throw new Error(errors.join('\n'))
    return { file, cropFile, rendering, ...checks }
  }
  finally { await context.close() }
}

export async function main() {
  const [surfaceName, ...args] = process.argv.slice(2)
  if (!surfaceName || !/^[a-z0-9][a-z0-9_-]*$/u.test(surfaceName) || (args.length && (args.length !== 2 || args[0] !== '--compare' || !args[1]))) throw new Error('Usage: pnpm design:capture <surface> [--compare <capture-dir>]')
  const surface = validateSurface(JSON.parse(await readFile(join(root, 'docs/design/surfaces', `${surfaceName}.json`), 'utf8')))
  const comparing = args.length > 0
  const baseline = comparing ? await readComparisonFloor(resolve(args[1])) : null
  const captures = surface.cases.flatMap(entry => surface.themes.flatMap(theme => surface.viewports.map(viewport => captureIdentity(surfaceName, entry, theme, viewport))))
  if (comparing) compareFloor({ surface: surfaceName, captures, violations: [] }, baseline)
  const sha = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
  const dirty = Boolean((await execFile('git', ['status', '--porcelain'], { cwd: root })).stdout.trim())
  const published = join(root, '.design-captures', surfaceName, sha.slice(0, 7))
  const output = await resetCaptureOutput(root, surfaceName, published)
  const started = Date.now()
  const manifest = { version: 1, surface: surfaceName, sha, dirty, definition: surface, startedAt: new Date(started).toISOString(), status: 'running', captures: [] }
  const floor = { version: 1, surface: surfaceName, sha, status: 'error', errors: ['Capture has not completed'], captures: [], violations: [], incomplete: [] }
  await writeJson(join(output, 'manifest.json'), manifest)
  await writeJson(join(output, 'floor.json'), floor)
  floor.errors = []
  try {
    browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false })
    const baseUrl = surface.kind === 'routes' ? await startStack() : null
    for (const entry of surface.cases) {
      for (const theme of surface.themes) {
        for (const viewport of surface.viewports) {
          if (interrupted || stackFailure) throw new Error(stackFailure || 'Capture interrupted')
          const identity = captureIdentity(surfaceName, entry, theme, viewport)
          try {
            const { violations, incomplete, axeVersion, ...files } = await capturePage(surface, identity, entry, baseUrl, output)
            floor.captures.push(identity)
            manifest.captures.push({ ...identity, status: 'complete', ...files, axeVersion })
            floor.violations.push(...violations.map(violation => ({ ...violation, capture: identity, id: violationId(violation.rule, identity, violation.selector) })))
            floor.incomplete.push(...incomplete.map(value => ({ ...value, capture: identity })))
            console.log(`${entry.kind}/${entry.state} ${theme} ${viewport.width}x${viewport.height}: ${violations.length} violations`)
          }
          catch (error) {
            manifest.captures.push({ ...identity, status: 'error', error: message(error) })
            throw error
          }
        }
      }
    }
    if (stackFailure) throw new Error(stackFailure)
  }
  catch (error) { floor.errors.push(message(error)) }
  finally {
    await browser?.close().catch(error => floor.errors.push(message(error)))
    await stopStack().catch(error => floor.errors.push(message(error)))
    if (interrupted) floor.errors.push('Capture interrupted')
    if (comparing) {
      try { floor.newViolations = compareFloor(floor, baseline).map(value => value.id) }
      catch (error) { floor.errors.push(message(error)); floor.newViolations = [] }
    }
    floor.status = floor.errors.length ? 'error' : 'complete'
    manifest.status = floor.status
    manifest.durationMs = Date.now() - started
    await writeJson(join(output, 'manifest.json'), manifest)
    await writeJson(join(output, 'floor.json'), floor)
  }
  if (!floor.errors.length) {
    try {
      await publishCaptureOutput(root, surfaceName, output, published, () => interrupted)
      if (interrupted) console.log('Capture interrupted after atomic publication; the complete published result stands.')
    }
    catch (error) {
      floor.errors.push(message(error))
      floor.status = manifest.status = 'error'
      await writeJson(join(output, 'manifest.json'), manifest)
      await writeJson(join(output, 'floor.json'), floor)
    }
  }
  if (floor.errors.length) console.error(`Staging capture kept for inspection; this folder can be deleted: ${output}`)
  console.log(`${floor.status}: ${manifest.captures.filter(value => value.status === 'complete').length} captures in ${(manifest.durationMs / 1000).toFixed(1)}s; ${floor.violations.length} violations${comparing ? `; ${floor.newViolations.length} new` : ''}\n${floor.errors.length ? output : published}`)
  for (const error of floor.errors) console.error(error)
  process.exitCode = floor.errors.length || (comparing && floor.newViolations.length) ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(message(error)); process.exitCode = 1 })
}
