import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// Full CLI and real Chromium, without Nuxt, Convex, or external assets.
// .mjs deliberately stays outside the default Vitest .test.ts include list.
const cli = fileURLToPath(new URL('./design-capture.mjs', import.meta.url))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const html = body => `<!doctype html><html lang="en"><head><title>Capture fixture</title>
<style>body{margin:0;background:white;color:black;font:16px Arial}main{padding:24px}button{min-width:32px;min-height:32px}</style>
</head><body><main data-ready="true"><h1>Capture fixture</h1>${body}</main></body></html>`

async function fixture(t, body = '<p>Ready for capture.</p>', options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'design-capture-browser-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', root])
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'test fixture'])
  const sha = execFileSync('git', ['-C', root, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim()
  const directory = join(root, 'docs/design/surfaces')
  await mkdir(directory, { recursive: true })
  const definition = {
    version: 1, kind: 'html', file: 'fixture.html', notes: 'Seeded browser regression.',
    themes: ['light'], viewports: [{ width: 320, height: 480 }],
    readySelector: 'main[data-ready=true]', contentSelector: 'main',
    cases: [{ kind: 'concept', state: 'ready' }], ...options,
  }
  await writeFile(join(directory, 'example.json'), JSON.stringify(definition))
  await writeFile(join(root, 'fixture.html'), html(body))
  const parent = join(root, '.design-captures/example')
  const published = join(parent, sha)
  function start(args = []) {
    const child = spawn(process.execPath, [cli, 'example', ...args], { cwd: root, env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    const timer = setTimeout(() => child.kill('SIGTERM'), 90_000)
    const done = once(child, 'exit').then(([code, signal]) => ({ code, signal, output })).finally(() => clearTimeout(timer))
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await done }
    })
    return { child, done }
  }
  async function reports(path) {
    return { floor: JSON.parse(await readFile(join(path, 'floor.json'), 'utf8')), manifest: JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')) }
  }
  async function failed(result, error) {
    assert.equal(result.code, 1, result.output)
    assert.match(result.output, error)
    const stages = (await readdir(parent)).filter(file => file.includes('.staging-'))
    assert.equal(stages.length, 1)
    const report = await reports(join(parent, stages[0]))
    assert.equal(report.floor.status, 'error')
    assert.equal(report.manifest.status, 'error')
    assert.match(report.floor.errors.join('\n'), error)
    return report
  }
  return { root, parent, published, start, reports, failed }
}

test('seeded axe, overflow, target size and fill separation reach the CLI floor', { timeout: 90_000 }, async t => {
  const f = await fixture(t, `<img id="unlabelled" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'/%3E">
    <div id="wide" style="width:500px">Too wide</div>
    <button id="tiny" style="min-width:0;min-height:0;width:12px;height:12px;padding:0;font-size:8px">Go</button>
    <div id="bubble">Bubble</div>`, { surfaceSeparation: [{ selectors: ['#bubble', 'main'], minContrast: 1.1 }] })
  const result = await f.start().done
  assert.equal(result.code, 0, result.output)
  const { floor, manifest } = await f.reports(f.published)
  for (const [rule, selector] of [['axe/image-alt', '#unlabelled'], ['horizontal-overflow', '#wide'], ['target-size-24', '#tiny'], ['surface-separation', '#bubble']]) {
    assert.ok(floor.violations.some(value => value.rule === rule && JSON.stringify(value.selector).includes(selector)), `${rule} missing: ${JSON.stringify(floor.violations)}`)
  }
  assert.equal(floor.status, 'complete')
  assert.equal(floor.captures.length, 1)
  assert.equal(manifest.captures[0].rendering.devicePixelRatio, 1)
  assert.equal(manifest.captures[0].rendering.theme, 'light')
  assert.equal((await readdir(f.published)).filter(file => file.endsWith('.png')).length, 2)
})

test('unmet readySelector fails with error staging', { timeout: 90_000 }, async t => {
  const f = await fixture(t, '<p>Still loading</p>', { readySelector: '#never-ready' })
  await f.failed(await f.start().done, /never-ready/)
  await assert.rejects(readFile(join(f.published, 'floor.json')), { code: 'ENOENT' })
})

test('missing required font fails with error staging', { timeout: 90_000 }, async t => {
  const f = await fixture(t, '<p>Fallback font</p>', { requiredFonts: ['MissingCaptureFont'] })
  await f.failed(await f.start().done, /Required font was not declared: MissingCaptureFont/)
})

test('failed request fails with error staging', { timeout: 90_000 }, async t => {
  const f = await fixture(t, '<img alt="Blocked asset" src="https://capture.invalid/blocked.svg">')
  await f.failed(await f.start().done, /capture.invalid\/blocked.svg.*ERR_BLOCKED_BY_CLIENT/)
})

test('compare exits zero for unchanged or removed debt and one for exactly one new violation', { timeout: 90_000 }, async t => {
  const f = await fixture(t)
  const initial = await f.start().done
  assert.equal(initial.code, 0, initial.output)
  assert.deepEqual((await f.reports(f.published)).floor.violations, [])
  const baseline = join(f.root, 'baseline')
  await cp(f.published, baseline, { recursive: true })
  const unchanged = await f.start(['--compare', baseline]).done
  assert.equal(unchanged.code, 0, unchanged.output)
  assert.match(unchanged.output, /; 0 new/)
  await writeFile(join(f.root, 'fixture.html'), html('<p>Ready.</p><div id="wide" style="width:500px">One new overflow</div>'))
  const added = await f.start(['--compare', baseline]).done
  assert.equal(added.code, 1, added.output)
  const changed = (await f.reports(f.published)).floor
  assert.equal(changed.status, 'complete')
  assert.equal(changed.newViolations.length, 1)
  assert.equal(changed.violations[0].rule, 'horizontal-overflow')
  await cp(f.published, join(f.root, 'debt-baseline'), { recursive: true })
  await writeFile(join(f.root, 'fixture.html'), html('<p>Ready for capture.</p>'))
  const removed = await f.start(['--compare', join(f.root, 'debt-baseline')]).done
  assert.equal(removed.code, 0, removed.output)
  assert.match(removed.output, /; 0 new/)
})

test('real SIGINT while publication is locked preserves prior output and retains error staging', { timeout: 90_000 }, async t => {
  const f = await fixture(t)
  await mkdir(f.published, { recursive: true })
  await writeFile(join(f.published, 'keep.txt'), 'previous publication')
  await mkdir(`${f.published}.publish-lock`)
  const run = f.start()
  const deadline = Date.now() + 60_000
  let ready = false
  while (Date.now() < deadline && run.child.exitCode === null) {
    const stages = await readdir(f.parent)
    for (const stage of stages.filter(file => file.includes('.staging-'))) {
      const report = await f.reports(join(f.parent, stage)).catch(() => null)
      if (report?.floor.status === 'complete') ready = true
    }
    if (ready) break
    await pause(20)
  }
  assert.ok(ready, 'CLI did not reach publication')
  // Give it time to enter the existing-lock wait before sending a real OS signal.
  await pause(100)
  assert.equal(run.child.kill('SIGINT'), true)
  await pause(100)
  await rm(`${f.published}.publish-lock`, { recursive: true })
  const result = await run.done
  await f.failed(result, /Capture interrupted before publication/)
  assert.equal(await readFile(join(f.published, 'keep.txt'), 'utf8'), 'previous publication')
  await assert.rejects(readFile(join(f.published, 'floor.json')), { code: 'ENOENT' })
})
