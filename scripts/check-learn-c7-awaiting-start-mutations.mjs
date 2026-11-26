import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const sandbox = await mkdtemp(path.join(tmpdir(), 'budds-c7-awaiting-start-'))
const pin = 'b4f2c8d49da8b87dc302abfa73500fc4353969a1'
const canvasPath = 'convex/learnAdaptiveCanvas.ts'
const deliveryPath = 'convex/lib/learnV2AssessmentDelivery.ts'
const testPath = 'convex/learnV2CanvasContract.test.ts'
const canvas = await readFile(path.join(root, canvasPath), 'utf8')
const delivery = await readFile(path.join(root, deliveryPath), 'utf8')
const tests = await readFile(path.join(root, testPath), 'utf8')

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, `Expected exactly one mutation target: ${before}`)
  return source.replace(before, after)
}

async function run(label, expectedFailures) {
  const report = path.join(sandbox, 'report.json')
  await rm(report, { force: true })
  let exitCode = 0
  try {
    await exec(path.join(root, 'node_modules/.bin/vitest'), ['run', testPath, '--maxWorkers=1', '--no-file-parallelism',
      '--testTimeout=60000', '-t', 'C7 awaiting-start', '--reporter=json', `--outputFile=${report}`],
    { cwd: sandbox, env: { ...process.env, CI: 'true' }, maxBuffer: 8 * 1024 * 1024 })
  } catch (error) {
    exitCode = error.code
  }
  const result = JSON.parse(await readFile(report, 'utf8'))
  const cases = result.testResults.flatMap(suite => suite.assertionResults).filter(test => test.status !== 'pending' && test.status !== 'skipped')
  assert.equal(cases.length, 25, `${label}: all registered cases must run; ${result.testResults.map(suite => suite.message).join(' ')}`)
  const failed = cases.filter(test => test.status === 'failed').map(test => test.fullName)
  const expected = cases.filter(test => expectedFailures(test.fullName)).map(test => test.fullName)
  assert.deepEqual(failed.sort(), expected.sort(), `${label}: unexpected failure set; ${cases.filter(test => test.status === 'failed').map(test => test.failureMessages.join(' ')).join(' ')}`)
  assert.equal(exitCode, expected.length ? 1 : 0, `${label}: unexpected runner exit`)
  console.log(`${label}: ${cases.length - failed.length} passed, ${failed.length} expected failures`)
}

try {
  for (const directory of ['convex', 'shared', 'server', 'tests', 'docs/operations']) await cp(path.join(root, directory), path.join(sandbox, directory), { recursive: true })
  for (const file of ['vitest.config.ts', 'tsconfig.json', 'package.json']) await cp(path.join(root, file), path.join(sandbox, file))
  for (const directory of ['node_modules', '.nuxt', 'workers']) await symlink(path.join(root, directory), path.join(sandbox, directory), 'dir')

  for (const file of [canvasPath, deliveryPath]) {
    const { stdout } = await exec('git', ['show', `${pin}:${file}`], { cwd: root, maxBuffer: 1024 * 1024 })
    await writeFile(path.join(sandbox, file), stdout)
  }
  let devTests = replaceOnce(tests, "assessment: { phase: 'ready', reasonCode: 'awaiting_start' }", "assessment: { phase: 'ready', reasonCode: 'not_admitted' }")
  devTests = replaceOnce(devTests, "expect(canvas.assessment).not.toHaveProperty('observations')\n  expectSafeCanvas(canvas, s)",
    "expect(canvas.assessment).toHaveProperty('observations', 'no_observations')\n  expectSafeCanvas(canvas, s)")
  devTests = replaceOnce(devTests, `    if (gate === 'replay_invalid' || gate === 'stored_action') {
      expect(await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, attach)).toMatchObject({ kind: 'not_admitted', reasonCode: 'disclosure_unknown' })
    } else expect(await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, attach)).toMatchObject({ kind: 'not_admitted' })`,
  `    if (gate === 'replay_invalid') await expect(s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, attach)).rejects.toThrow('Factual activity requires complete generation inputs')
    else expect(await s.owner.mutation(api.learnAdaptiveCanvas.attachReadySession, attach)).toMatchObject({ kind: 'not_admitted' })`)
  await writeFile(path.join(sandbox, testPath), devTests)
  await run(`Pinned baseline ${pin}`, name => name.includes('stored_action'))

  await writeFile(path.join(sandbox, testPath), tests)
  await writeFile(path.join(sandbox, deliveryPath), delivery)
  const coreCheck = '  if (canonicalAdaptiveActivityJson({ ...core, assessmentReference: reference }) !== canonicalInputSnapshot) return false\n'
  await writeFile(path.join(sandbox, canvasPath), replaceOnce(canvas, coreCheck, ''))
  await run('Removed stored-core validation', name => name.includes('stored_action') || name.includes('replay_invalid'))

  const condition = 'const awaitingStart = startReason === null'
  await writeFile(path.join(sandbox, canvasPath), replaceOnce(canvas, condition, 'const awaitingStart = false'))
  await run('Removed condition', name => name.includes('ready check'))

  await writeFile(path.join(sandbox, canvasPath), replaceOnce(canvas, condition, 'const awaitingStart = true'))
  await run('Widened admission', name => name.includes('remains not admitted') || name.includes('responses off'))

  const widened = replaceOnce(canvas, condition, 'const awaitingStart = true')
  await writeFile(path.join(sandbox, canvasPath), replaceOnce(widened,
    "reasonCode: delivered ? opportunity.reasonCode ?? null : awaitingStart ? 'awaiting_start' : 'not_admitted'",
    "reasonCode: awaitingStart ? 'awaiting_start' : delivered ? opportunity.reasonCode ?? null : 'not_admitted'"))
  await run('Widened into delivered work', () => true)
} finally {
  await rm(sandbox, { recursive: true, force: true })
}
