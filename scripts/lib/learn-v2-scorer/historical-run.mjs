import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, hash, readJson, unseal, implementationPins, exists } from './artifacts.mjs'

const versions = new Map()
process.once('exit', () => {
  for (const version of versions.values()) if (version.directory !== ROOT) rmSync(version.directory, { recursive: true, force: true })
})

function pinnedBytes(file, digest, commit) {
  assert.ok(resolve(ROOT, file).startsWith(ROOT) && !file.startsWith('.') && !file.includes('..'), 'Invalid historical source path')
  assert.match(digest, /^sha256:[a-f0-9]{64}$/)
  const current = exists(join(ROOT, file)) ? readFileSync(join(ROOT, file)) : null
  const bytes = current && hash(current) === digest ? current
    : execFileSync('git', ['show', `${commit}:${file}`], { cwd: ROOT, maxBuffer: 4_000_000, stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(hash(bytes), digest, `Historical source digest mismatch: ${file}`)
  return bytes
}

async function verifier(pins) {
  const key = hash([pins.implementation, pins.corpusHashes, pins.corpusManifest])
  const current = hash(implementationPins()) === hash(pins.implementation)
  if (versions.has(key) && (versions.get(key).directory !== ROOT || current)) return versions.get(key)
  let directory = ROOT
  if (!current) {
    assert.equal(pins.implementation.node, process.versions.node, 'Historical replay requires its pinned Node version')
    assert.match(pins.implementation.repositoryCommit, /^[a-f0-9]{40}$/)
    directory = mkdtempSync(join(tmpdir(), 'budds-scorer-replay-'))
    try {
      const files = { ...pins.implementation.files,
        ...Object.fromEntries(Object.entries(pins.corpusHashes).map(([name, digest]) => [`tests/fixtures/learn-v2-scorer/${name}.v1.json`, digest])),
        'docs/research/learn-anything-scorer-harness.md': `sha256:${pins.corpusManifest.contract.researchSha256}` }
      for (const [file, digest] of Object.entries(files)) {
        const bytes = pinnedBytes(file, digest, pins.implementation.repositoryCommit)
        mkdirSync(dirname(join(directory, file)), { recursive: true })
        writeFileSync(join(directory, file), bytes, { flag: 'wx', mode: 0o400 })
      }
      // A detached HEAD supplies the sealed revision to the original verifier;
      // no checkout, index, refs or tracked files in the caller are modified.
      mkdirSync(join(directory, '.git'))
      writeFileSync(join(directory, '.git/HEAD'), `${pins.implementation.repositoryCommit}\n`)
      writeFileSync(join(directory, '.git/commondir'), execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT }))
      symlinkSync(join(ROOT, 'node_modules'), join(directory, 'node_modules'), 'dir')
    }
    catch (error) { rmSync(directory, { recursive: true, force: true }); throw error }
  }
  const load = name => import(pathToFileURL(join(directory, `scripts/lib/learn-v2-scorer/${name}.mjs`)).href)
  try {
    const [state, adapters, approval, report] = await Promise.all([load('run-state'), load('adapters'), load('live-approval'), load('report')])
    const version = { directory, ...state, ...adapters, ...approval, ...report }
    versions.set(key, version)
    return version
  }
  catch (error) { if (directory !== ROOT) rmSync(directory, { recursive: true, force: true }); throw error }
}

// Execute only saved-response replay from the exact source bytes sealed by the
// run. No historical runner/transport entry point is called. Its original
// assertCurrent verifies the reconstructed sources, corpus, lockfile and HEAD.
export async function openHistoricalRun(directory, expectedPinsDigest) {
  const raw = readJson(join(directory, 'manifest.json'))
  const manifest = unseal(directory, 'manifest.json', 'manifest', raw.pinsDigest)
  assert.equal(hash(manifest.payload), manifest.pinsDigest, 'Incomplete historical run pins')
  if (expectedPinsDigest) assert.equal(manifest.pinsDigest, expectedPinsDigest, 'Historical manifest differs from its global claim')
  const replay = await verifier(manifest.payload)
  const state = await replay.openRun(directory)
  state.replay = replay
  return state
}
