import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireCaptureStackLock, captureIdentity, compareFloor, normalizeSelector, publishCaptureOutput, readComparisonFloor, resetCaptureOutput, selectCaptureBaseUrl, stopCaptureStack, stopChild, validateSurface, violationId } from './design-capture-lib.mjs'
import { checkLayout } from './design-capture-checks.mjs'

const surface = {
  version: 1,
  kind: 'routes',
  notes: 'A bounded synthetic fixture.',
  themes: ['dark', 'light'],
  viewports: [{ width: 320, height: 640 }],
  contentSelector: 'main',
  readySelector: 'main[data-ready=true]',
  cases: [{ kind: 'explanation', state: 'ready', path: '/__e2e/canvas?state=ready' }],
}
const capture = captureIdentity('example', surface.cases[0], 'dark', surface.viewports[0])
const floor = { version: 1, surface: 'example', status: 'complete', errors: [], captures: [capture], violations: [{ id: 'known' }] }

describe('capture loopback ports', () => {
  it('claims a dead owner exclusively and stops its recorded orphan stack before returning', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-capture-orphan-'))
    const lock = join(root, 'stack.lock')
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { spawn } from 'node:child_process'
      import { acquireCaptureStackLock } from ${JSON.stringify(new URL('./design-capture-lib.mjs', import.meta.url).href)}
      const release = await acquireCaptureStackLock(${JSON.stringify(lock)})
      const stack = spawn(process.execPath, ['-e', "setInterval(() => {}, 1000); process.stdout.write('ready')"], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
      stack.stdout.once('data', () => { release.recordStack(stack.pid); process.stdout.write(String(stack.pid)) })
    `], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stackPid
    try {
      stackPid = Number(String((await once(child.stdout!, 'data'))[0]))
      child.kill('SIGKILL')
      await once(child, 'exit')
      const contenders = await Promise.allSettled([acquireCaptureStackLock(lock), acquireCaptureStackLock(lock)])
      for (const contender of contenders) if (contender.status === 'fulfilled') await contender.value()
      expect(contenders.filter(value => value.status === 'fulfilled')).toHaveLength(1)
      expect(() => process.kill(-stackPid, 0)).toThrow()
    }
    finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      if (stackPid) try { process.kill(-stackPid, 'SIGKILL') } catch { /* Only this test's recorded stack group. */ }
      await rm(root, { recursive: true, force: true })
    }
  }, 40_000)

  it('recovers a SIGKILLed owner and admits only one stale-lock contender', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-capture-stale-'))
    const lock = join(root, 'stack.lock')
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { acquireCaptureStackLock } from ${JSON.stringify(new URL('./design-capture-lib.mjs', import.meta.url).href)}
      await acquireCaptureStackLock(${JSON.stringify(lock)})
      process.stdout.write('ready'); setInterval(() => {}, 1000)
    `], { stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await once(child.stdout!, 'data')
      const files = await readdir(lock)
      expect(JSON.parse(await readFile(join(lock, files[0]), 'utf8')).pid).toBe(child.pid)
      child.kill('SIGKILL')
      await once(child, 'exit')
      const contenders = await Promise.allSettled(Array.from({ length: 8 }, () => acquireCaptureStackLock(lock)))
      const winners = contenders.filter(value => value.status === 'fulfilled')
      expect(winners).toHaveLength(1)
      expect(contenders.filter(value => value.status === 'rejected')).toHaveLength(7)
      for (const winner of winners) if (winner.status === 'fulfilled') await winner.value()
      await expect(readdir(lock)).rejects.toThrow('ENOENT')
    }
    finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('releases the stack lock after forced cleanup while retaining the timeout error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-capture-timeout-'))
    const lock = join(root, 'stack.lock')
    const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('ready')"], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await once(child.stdout!, 'data')
      const release = await acquireCaptureStackLock(lock)
      await expect(stopCaptureStack(child, release, 100)).rejects.toThrow('cleanup timed out')
      expect(child.signalCode).toBe('SIGKILL')
      const releaseNext = await acquireCaptureStackLock(lock)
      await releaseNext()
    }
    finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('rejects another route stack until its owner finishes cleanup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-capture-lock-'))
    const lock = join(root, 'stack.lock')
    try {
      const release = await acquireCaptureStackLock(lock)
      try { await expect(acquireCaptureStackLock(lock)).rejects.toThrow('Another route capture owns') }
      finally { await Promise.all([release(), release()]) }
      const releaseNext = await acquireCaptureStackLock(lock)
      await releaseNext()
      await releaseNext()
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })

  it('uses independent OS-assigned ports for simultaneous default captures', async () => {
    const urls = await Promise.all([selectCaptureBaseUrl(), selectCaptureBaseUrl()])
    expect(urls[0].hostname).toBe('127.0.0.1')
    expect(Number(urls[0].port)).toBeGreaterThan(0)
    expect(urls[0].port).not.toBe(urls[1].port)
    expect(urls.every(url => url.port !== '3102')).toBe(true)
  })

  it('preserves explicit ports and rejects an occupied explicit port', async () => {
    const server = createServer()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected loopback address')
    const url = `http://127.0.0.1:${address.port}`
    try { await expect(selectCaptureBaseUrl(url)).rejects.toThrow('EADDRINUSE') }
    finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
    expect((await selectCaptureBaseUrl(url)).origin).toBe(url)
  })
})

describe('surface definitions', () => {
  it('accepts route and standalone HTML surfaces', () => {
    expect(validateSurface(surface).surfaceSeparation).toEqual([])
    expect(validateSurface({ ...surface, kind: 'html', file: '/tmp/concept.html', cases: [{ kind: 'concept', state: 'ready' }] }).kind).toBe('html')
  })

  it.each([
    { themes: [] }, { themes: ['sepia'] }, { themes: ['dark', 'dark'] },
    { viewports: [{ width: 0, height: 640 }] }, { viewports: [surface.viewports[0], surface.viewports[0]] },
    { cases: [] }, { cases: [surface.cases[0], surface.cases[0]] },
    { notes: '' }, { contentSelector: '' }, { readySelector: '' }, { typo: true },
    { surfaceSeparation: [{ selectors: ['body'], minContrast: 1.1 }] },
    { surfaceSeparation: [{ selectors: ['main', 'body'], minContrast: 22 }] },
  ])('rejects invalid or ambiguous definitions: %j', change => {
    expect(() => validateSurface({ ...surface, ...change })).toThrow()
  })

  it.each(['https://example.com/', '//example.com/', '/\\example.com/', 'relative', 'file:///tmp/mock.html'])('rejects non-local routes: %s', path => {
    expect(() => validateSurface({ ...surface, cases: [{ ...surface.cases[0], path }] })).toThrow()
  })

  it('requires an HTML file and rejects route paths on HTML cases', () => {
    expect(() => validateSurface({ ...surface, kind: 'html' })).toThrow()
    expect(() => validateSurface({ ...surface, kind: 'html', file: 'concept.html' })).toThrow()
  })
})

describe('violation identity', () => {
  it('ignores SHA, metrics, and property insertion order', () => {
    const reordered = { viewport: { height: 640, width: 320 }, theme: 'dark', state: 'ready', kind: 'explanation', surface: 'example', sha: 'different' }
    expect(violationId('axe/contrast', capture, ['main', '#button'])).toBe(violationId('axe/contrast', reordered, ['main', '#button']))
  })

  it('distinguishes rules, selectors, and every capture dimension', () => {
    const id = violationId('target-size-24', capture, '#save')
    expect(violationId('horizontal-overflow', capture, '#save')).not.toBe(id)
    expect(violationId('target-size-24', capture, '#other')).not.toBe(id)
    for (const change of [{ surface: 'other' }, { kind: 'artifact' }, { state: 'active' }, { theme: 'light' }, { viewport: { width: 390, height: 844 } }]) {
      expect(violationId('target-size-24', { ...capture, ...change }, '#save')).not.toBe(id)
    }
  })

  it('preserves selector boundaries', () => {
    expect(violationId('axe/contrast', capture, ['a,b', 'c'])).not.toBe(violationId('axe/contrast', capture, ['a', 'b,c']))
  })
})

describe('floor comparison', () => {
  it('accepts existing debt, removals, and self-comparison', () => {
    expect(compareFloor(floor, floor)).toEqual([])
    expect(compareFloor({ ...floor, violations: [] }, floor)).toEqual([])
  })

  it('returns only newly introduced IDs', () => {
    expect(compareFloor({ ...floor, violations: [{ id: 'new' }, { id: 'known' }] }, floor)).toEqual([{ id: 'new' }])
    expect(compareFloor(floor, { ...floor, violations: [] })).toEqual([{ id: 'known' }])
  })

  it.each([
    { ...floor, status: 'error' }, { ...floor, status: 'running' },
    { ...floor, errors: ['Browser failed'] }, { ...floor, violations: [{}] },
    { ...floor, version: 2 }, {}, null,
  ])('rejects incomplete or invalid baselines: %j', baseline => {
    expect(() => compareFloor(floor, baseline)).toThrow()
  })

  it('rejects a different surface', () => {
    expect(() => compareFloor({ ...floor, surface: 'another' }, floor)).toThrow('same surface')
  })
})


describe('capture coverage', () => {
  it.each([
    { ...capture, theme: 'light' },
    { ...capture, viewport: { width: 390, height: 844 } },
    { ...capture, state: 'fallback' },
  ])('rejects missing baseline coverage even without violations: %j', missing => {
    expect(() => compareFloor({ ...floor, violations: [] }, { ...floor, captures: [capture, missing], violations: [] }))
      .toThrow(`Missing baseline captures: ${missing.kind}/${missing.state} ${missing.theme} ${missing.viewport.width}x${missing.viewport.height}`)
  })

  it('allows added captures and reports their new violations', () => {
    expect(compareFloor({ ...floor, captures: [capture, { ...capture, theme: 'light' }], violations: [{ id: 'added' }] }, floor)).toEqual([{ id: 'added' }])
  })

  it('rejects legacy baselines without capture identities', () => {
    const { captures: _captures, ...legacy } = floor
    expect(() => compareFloor(floor, legacy)).toThrow()
  })
})

describe('generated selectors', () => {
  it.each([['#v-0', '#v-98'], ['#v-0-1', '#v-9-88'], ['#reka-v-1', '#reka-v-7'], ['#reka-1', '#reka-33'], ['#reka-v-1-trigger-settings', '#reka-v-99-trigger-settings']])('ignores allocation counters: %s and %s', (before, after) => {
    expect(violationId('target-size-24', capture, before)).toBe(violationId('target-size-24', capture, after))
    expect(violationId('axe/label', capture, [['main', before]])).toBe(violationId('axe/label', capture, [['main', after]]))
  })

  it('keeps authored IDs and selector structure distinct', () => {
    expect(normalizeSelector('main > #save, #v-settings')).toBe('main > #save, #v-settings')
    expect(violationId('axe/label', capture, '#reka-v-1-trigger-one')).not.toBe(violationId('axe/label', capture, '#reka-v-2-trigger-two'))
    expect(violationId('axe/label', capture, ['#v-1 > input'])).not.toBe(violationId('axe/label', capture, ['#v-2 > button']))
  })
})

describe('capture publication', () => {
  it('keeps the committed result when cancellation arrives after the rename', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-capture-committed-'))
    try {
      const output = join(root, '.design-captures/example/abc1234')
      const staging = await resetCaptureOutput(root, 'example', output)
      await writeFile(join(staging, 'floor.json'), JSON.stringify(floor))
      let checks = 0
      let interrupted = false
      await publishCaptureOutput(root, 'example', staging, output, () => {
        // The final guard and both renames execute synchronously. A signal
        // callback can only run on the next yield, after the committed rename.
        if (++checks === 2) queueMicrotask(() => { interrupted = true })
        return interrupted
      })
      expect(interrupted).toBe(true)
      expect(await readComparisonFloor(output)).toEqual(floor)
      await expect(readdir(staging)).rejects.toThrow('ENOENT')
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })

  it('keeps the published baseline until a complete staging capture replaces it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-capture-publish-'))
    try {
      const output = join(root, '.design-captures/example/abc1234')
      await mkdir(output, { recursive: true })
      await writeFile(join(output, 'obsolete.png'), 'last good frame')
      await writeFile(join(output, 'floor.json'), JSON.stringify(floor))
      const staging = await resetCaptureOutput(root, 'example', output)
      expect(staging).toMatch(/abc1234\.staging-[^/]+$/)
      expect(await readdir(staging)).toEqual([])
      expect(await readComparisonFloor(output)).toEqual(floor)
      expect(await readFile(join(output, 'obsolete.png'), 'utf8')).toBe('last good frame')
      await writeFile(join(staging, 'current.png'), 'new frame')
      await writeFile(join(staging, 'floor.json'), JSON.stringify(floor))
      await expect(readComparisonFloor(staging)).rejects.toThrow('staging folder')
      await publishCaptureOutput(root, 'example', staging, output)
      expect((await readdir(output)).sort()).toEqual(['current.png', 'floor.json'])
      expect(compareFloor(floor, await readComparisonFloor(output))).toEqual([])
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })

  it('publishes concurrent runs as whole folders without mixing their files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-capture-concurrent-'))
    try {
      const output = join(root, '.design-captures/example/abc1234')
      const stages = await Promise.all([resetCaptureOutput(root, 'example', output), resetCaptureOutput(root, 'example', output)])
      expect(new Set(stages).size).toBe(2)
      await Promise.all(stages.map(async (stage, index) => {
        await writeFile(join(stage, `${index}.png`), String(index))
        await writeFile(join(stage, 'manifest.json'), String(index))
      }))
      await Promise.all(stages.map(stage => publishCaptureOutput(root, 'example', stage, output)))
      const winner = await readFile(join(output, 'manifest.json'), 'utf8')
      expect((await readdir(output)).sort()).toEqual([`${winner}.png`, 'manifest.json'])
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })

  it('refuses the surface root, outside paths and symlink escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-capture-safe-'))
    try {
      const parent = join(root, '.design-captures/example')
      const outside = join(root, 'preserved')
      await mkdir(parent, { recursive: true })
      await mkdir(outside)
      await writeFile(join(outside, 'keep.png'), 'keep')
      for (const path of [parent, outside, join(parent, '../other')]) await expect(resetCaptureOutput(root, 'example', path)).rejects.toThrow('inside')
      await symlink(outside, join(parent, 'abc1234'))
      await expect(resetCaptureOutput(root, 'example', join(parent, 'abc1234'))).rejects.toThrow('symlink')
      expect(await readFile(join(outside, 'keep.png'), 'utf8')).toBe('keep')
      await symlink(outside, join(root, '.design-captures/linked'))
      await expect(resetCaptureOutput(root, 'linked', join(root, '.design-captures/linked/abc1234'))).rejects.toThrow('symlink')
    }
    finally { await rm(root, { recursive: true, force: true }) }
  })
})

describe('stack interruption', () => {
  it('releases after transient EPERM only once the owned group is confirmed gone', async () => {
    const root = await mkdtemp(join(tmpdir(), 'design-capture-eperm-'))
    const child = spawn(process.execPath, ['-e', "setInterval(() => {}, 1000); process.stdout.write('ready')"], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const kill = process.kill.bind(process)
    let deniedProbe = false
    try {
      await once(child.stdout!, 'data')
      const lock = join(root, 'stack.lock')
      const release = await acquireCaptureStackLock(lock)
      vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
        if (pid === -child.pid! && (signal === 'SIGKILL' || signal === 0 && !deniedProbe)) {
          if (signal === 0) deniedProbe = true
          throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' })
        }
        return kill(pid, signal)
      })
      await stopCaptureStack(child, release)
      expect(deniedProbe).toBe(true)
      const releaseNext = await acquireCaptureStackLock(lock)
      await releaseNext()
    }
    finally {
      vi.restoreAllMocks()
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('sends one SIGTERM and waits for asynchronous one-shot cleanup', async () => {
    const child = spawn(process.execPath, ['-e', `
      setInterval(() => {}, 1000)
      process.once('SIGTERM', () => setTimeout(() => { process.stdout.write('cleaned'); process.exit(0) }, 150))
      process.stdout.write('ready')
    `], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await once(child.stdout!, 'data')
      const cleaned = once(child.stdout!, 'data')
      const first = stopChild(child)
      await new Promise(resolve => setTimeout(resolve, 25))
      await Promise.all([first, stopChild(child)])
      expect(String((await cleaned)[0])).toBe('cleaned')
      expect(child.exitCode).toBe(0)
      expect(child.signalCode).toBeNull()
    }
    finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
  })

  it('escalates only when cleanup times out', async () => {
    const child = spawn(process.execPath, ['-e', `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('ready')`], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await once(child.stdout!, 'data')
      await expect(stopChild(child, 100)).rejects.toThrow('cleanup timed out')
      expect(child.signalCode).toBe('SIGKILL')
    }
    finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
  })
  it.each([false, true])('cleans descendants even when the stack has already exited: %s', async alreadyExited => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { spawn } from 'node:child_process'
      const grandchild = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('ready')"], { stdio: ['ignore', 'pipe', 'ignore'] })
      grandchild.stdout.once('data', () => {
        process.stdout.write(String(grandchild.pid))
        ${alreadyExited ? "grandchild.unref(); grandchild.stdout.destroy(); process.exit(0)" : "process.once('SIGTERM', () => setTimeout(() => process.exit(0), 100))"}
      })
    `], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      const pid = Number(String((await once(child.stdout!, 'data'))[0]))
      if (alreadyExited && child.exitCode === null) await once(child, 'exit')
      await stopChild(child)
      await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 2000 })
    }
    finally {
      try { process.kill(-child.pid!, 'SIGKILL') } catch { /* Only this test's process group is eligible for cleanup. */ }
    }
  })

})

describe('adaptive frame separation guard', () => {
  it('passes current fills but fails collapsed fills, without claiming quality', async () => {
    const definition = JSON.parse(await readFile(new URL('../docs/design/surfaces/learn-adaptive-canvases.json', import.meta.url), 'utf8'))
    const minimum = definition.surfaceSeparation[0].minContrast
    expect(1.0997).toBeGreaterThanOrEqual(minimum)
    expect(1.0621).toBeGreaterThanOrEqual(minimum)
    expect(1).toBeLessThan(minimum)
    expect(definition.notes).toMatch(/regression.*not a claim.*quality/)
  })
})

describe('layout target identity and hidden inputs', () => {
  afterEach(() => vi.unstubAllGlobals())

  function layout(html: string, sizes: Record<string, [number, number]>) {
    const window = new Window()
    window.document.body.innerHTML = html
    vi.stubGlobal('document', window.document)
    vi.stubGlobal('CSS', window.CSS)
    vi.stubGlobal('getComputedStyle', window.getComputedStyle.bind(window))
    for (const element of window.document.querySelectorAll('*')) {
      const [width, height] = sizes[element.id] || [100, 100]
      const rect = { width, height, top: 0, left: 0, right: width, bottom: height }
      element.checkVisibility = () => true
      element.getClientRects = () => [rect] as any
      element.getBoundingClientRect = () => rect as any
    }
    return checkLayout().filter((finding: any) => finding.rule === 'target-size-24')
  }

  it('prefers a unique test ID to a generated ID while reporting the raw selector', () => {
    const findings = layout('<button id="reka-v-1" data-testid="save">Save</button>', { 'reka-v-1': [20, 20] })
    expect(findings[0].selector).toBe('[data-testid="save"]')
  })

  it.each(['width:1px;height:1px', 'clip:rect(0px,0px,0px,0px)', 'clip-path:inset(50%)'])('uses a full-size explicit label for hidden input: %s', style => {
    expect(layout(`<input id="input" style="${style}"><label id="label" for="input">Select</label>`, { input: style.startsWith('width') ? [1, 1] : [30, 30], label: [32, 32] })).toEqual([])
  })

  it('uses an enclosing label for a visually hidden input', () => {
    expect(layout('<label id="label">Select<input id="input"></label>', { input: [1, 1], label: [32, 32] })).toEqual([])
  })

  it.each(['aria-hidden="true"', 'tabindex="-1"'])('skips visually hidden form transport inputs: %s', attributes => {
    expect(layout(`<form><button role="checkbox" id="control">Select</button><input id="transport" type="checkbox" name="selected" ${attributes}></form>`, { control: [32, 32], transport: [1, 1] })).toEqual([])
    expect(layout(`<input id="visible" ${attributes}>`, { visible: [20, 20] })).toHaveLength(1)
  })

  it('reports a small label and a hidden input without a label', () => {
    const findings = layout('<input id="small"><label id="label" for="small">Small</label><input id="unlabelled">', { small: [1, 1], label: [12, 12], unlabelled: [1, 1] })
    expect(findings.map((finding: any) => finding.selector)).toEqual(['#small', '#unlabelled'])
    expect(findings[0].rects).toEqual([{ width: 12, height: 12 }])
  })

  it('reports a clipped input without a label even with a large layout box', () => {
    expect(layout('<input id="input" style="clip-path:inset(50%)">', { input: [30, 30] })).toHaveLength(1)
  })

  it('keeps visible undersized inputs as findings even with a large label', () => {
    expect(layout('<input id="input"><label id="label" for="input">Select</label>', { input: [20, 20], label: [32, 32] })).toHaveLength(1)
  })
})


describe('CLI failure lifecycle without a browser', () => {
  it.each(['capture failure', 'SIGINT', 'stack exit'])('stages output and stops the detached stack on %s', async mode => {
    const interrupt = mode === 'SIGINT'
    const root = await mkdtemp(join(tmpdir(), 'design-capture-cli-'))
    const originalArgv = process.argv
    const originalExitCode = process.exitCode
    const listeners = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, process.listeners(signal)]))
    const child = spawn(process.execPath, ['-e', "setInterval(() => {}, 1000); process.stdout.write('ready')"], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      await once(child.stdout!, 'data')
      execFileSync('git', ['init', '-q', root])
      execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'test fixture'])
      const sha = execFileSync('git', ['-C', root, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim()
      await mkdir(join(root, 'docs/design/surfaces'), { recursive: true })
      await writeFile(join(root, 'docs/design/surfaces/example.json'), JSON.stringify(surface))
      const output = join(root, '.design-captures/example', sha)
      await mkdir(output, { recursive: true })
      await writeFile(join(output, 'keep.png'), 'last good frame')
      vi.resetModules()
      vi.doMock('node:os', async () => ({ ...await vi.importActual<typeof import('node:os')>('node:os'), tmpdir: () => root }))
      const spawnStack = vi.fn(() => child)
      vi.doMock('node:child_process', async () => ({ ...await vi.importActual<typeof import('node:child_process')>('node:child_process'), spawn: spawnStack }))
      vi.doMock('node:net', () => ({ createServer: () => ({ once() {}, listen(_port: number, _host: string, ready: () => void) { ready() }, address() { return { port: 43210 } }, close(done: () => void) { done() } }) }))
      const launchBrowser = vi.fn(async () => ({ newContext: async () => {
        if (interrupt) process.emit('SIGINT')
        throw new Error('synthetic capture failure')
      }, close: async () => {} }))
      vi.doMock('@playwright/test', () => ({ chromium: { launch: launchBrowser } }))
      vi.stubGlobal('fetch', async () => {
        if (mode === 'stack exit') {
          const exited = once(child, 'exit')
          child.kill('SIGTERM')
          await exited
        }
        return { ok: true }
      })
      vi.spyOn(process, 'cwd').mockReturnValue(root)
      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})
      process.argv = ['node', 'scripts/design-capture.mjs', 'example']
      const { main } = await import('./design-capture.mjs')
      await main()
      expect(launchBrowser).toHaveBeenCalledWith({ handleSIGINT: false, handleSIGTERM: false })
      expect(spawnStack).toHaveBeenCalledWith(process.execPath, ['scripts/e2e-stack.mjs'], expect.objectContaining({ detached: true, stdio: 'inherit' }))
      expect(child.signalCode).toBe('SIGTERM')
      expect(await readFile(join(output, 'keep.png'), 'utf8')).toBe('last good frame')
      const stages = (await readdir(join(root, '.design-captures/example'))).filter(value => value.includes('.staging-'))
      expect(stages).toHaveLength(1)
      const failed = JSON.parse(await readFile(join(root, '.design-captures/example', stages[0], 'floor.json'), 'utf8'))
      expect(failed.status).toBe('error')
      expect(failed.errors).toContain(mode === 'stack exit' ? 'Disposable E2E stack exited (SIGTERM)' : 'synthetic capture failure')
      if (mode === 'stack exit') expect(failed.captures).toEqual([])
      if (interrupt) expect(failed.errors).toContain('Capture interrupted')
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('this folder can be deleted:'))
      expect(process.exitCode).toBe(1)
      expect((await readdir(root)).filter(name => name.startsWith('budds-design-capture-stack-'))).toEqual([])
    }
    finally {
      vi.doUnmock('node:child_process')
      vi.doUnmock('node:net')
      vi.doUnmock('node:os')
      vi.doUnmock('@playwright/test')
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      vi.resetModules()
      process.argv = originalArgv
      process.exitCode = originalExitCode
      for (const [signal, original] of listeners) for (const listener of process.listeners(signal)) if (!original.includes(listener)) process.removeListener(signal, listener)
      try { process.kill(-child.pid!, 'SIGKILL') } catch { /* Only this test's process group is eligible for cleanup. */ }
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
