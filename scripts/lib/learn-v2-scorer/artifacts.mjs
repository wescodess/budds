import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { constants, lstatSync, statSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, fsyncSync, linkSync, unlinkSync, realpathSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
export const FIXTURES = join(ROOT, 'tests/fixtures/learn-v2-scorer')
export const VERSION = 'mastery.scorer-evaluation.v1'
export const POLICY = 'learn-v2.public-synthetic-payload.v1'
export const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}
export const hash = value => `sha256:${createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex')}`
export const readJson = file => {
  assert.ok(statSync(file).size <= 2_000_000, 'JSON artifact exceeds its byte ceiling')
  return JSON.parse(readFileSync(file, 'utf8'))
}
export function exactKeys(object, keys) {
  assert.ok(object && typeof object === 'object' && !Array.isArray(object), 'Object required')
  assert.deepEqual(Object.keys(object).sort(), [...keys].sort(), 'Unexpected or missing fields')
}

export function outputDirectory(path) {
  const directory = resolve(path)
  // Resolve existing parents before creating anything, including symlink parents.
  let parent = directory
  while (!exists(parent)) parent = dirname(parent)
  const actual = resolve(realpathSync(parent), relative(parent, directory))
  const fromRoot = relative(realpathSync(ROOT), actual)
  assert.ok(fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot), 'Run artifacts must be outside the repository')
  mkdirSync(actual, { recursive: true, mode: 0o700 })
  assert.ok(!lstatSync(actual).isSymbolicLink(), 'Artifact directory cannot be a symlink')
  return actual
}
export const exists = path => {
  try { lstatSync(path); return true }
  catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

function syncDirectory(directory) {
  const fd = openSync(directory, constants.O_RDONLY)
  try { fsyncSync(fd) }
  finally { closeSync(fd) }
}

export function seal(directory, name, kind, pinsDigest, payload) {
  assert.match(name, /^[a-zA-Z0-9._-]+\.json$/)
  const value = { version: VERSION, kind, pinsDigest, payload }
  const bytes = `${canonical({ ...value, digest: hash(value) })}\n`
  const file = join(directory, name)
  if (exists(file)) {
    assert.equal(readFileSync(file, 'utf8'), bytes, `Sealed artifact changed: ${name}`)
    return readJson(file)
  }
  // Publish an fsynced inode exclusively. A crash leaves either no artifact or a
  // complete artifact; an existing intent can never be overwritten on restart.
  const temporary = `${file}.${process.pid}.tmp`
  const fd = openSync(temporary, 'wx', 0o600)
  try { writeFileSync(fd, bytes); fsyncSync(fd) }
  finally { closeSync(fd) }
  try { linkSync(temporary, file); syncDirectory(directory) }
  finally { unlinkSync(temporary) }
  return readJson(file)
}

export function unseal(directory, name, kind, pinsDigest) {
  const file = join(directory, name)
  assert.ok(!lstatSync(file).isSymbolicLink(), 'Sealed artifact cannot be a symlink')
  const value = readJson(file)
  exactKeys(value, ['version', 'kind', 'pinsDigest', 'payload', 'digest'])
  const { digest, ...unsigned } = value
  assert.equal(value.version, VERSION)
  assert.equal(value.kind, kind)
  assert.equal(value.pinsDigest, pinsDigest)
  assert.equal(digest, hash(unsigned), `Artifact digest mismatch: ${name}`)
  assert.equal(readFileSync(file, 'utf8'), `${canonical(value)}\n`, 'Noncanonical sealed artifact')
  return value
}

export function removeSealed(directory, name, kind, pinsDigest) {
  assert.match(name, /^[a-zA-Z0-9._-]+\.json$/)
  unseal(directory, name, kind, pinsDigest)
  unlinkSync(join(directory, name))
  syncDirectory(directory)
}

export function exclusiveLock(directory, name, operation) {
  const file = join(directory, name)
  let fd
  try { fd = openSync(file, 'wx', 0o600) }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Harness lock requires owner reconciliation; never steal a lock', { cause: error }); throw error }
  writeFileSync(fd, `${process.pid}\n`)
  fsyncSync(fd)
  // This releases only the transient mutex. Global reservation intents persist
  // independently until their terminal/resolution records are durably sealed.
  return Promise.resolve().then(operation).finally(() => { closeSync(fd); unlinkSync(file); syncDirectory(directory) })
}

export function implementationPins() {
  const files = new Set(['pnpm-lock.yaml', 'package.json', 'scripts/learn-v2-scorer-harness.mjs', 'scripts/learn-v2-scorer-corpus.mjs'])
  for (const file of readdirSync(join(ROOT, 'scripts/lib/learn-v2-scorer'))) if (file.endsWith('.mjs')) files.add(`scripts/lib/learn-v2-scorer/${file}`)
  const visit = file => {
    if (files.has(file)) return
    files.add(file)
    const bytes = readFileSync(join(ROOT, file), 'utf8')
    for (const match of bytes.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('.')) continue
      const dependency = relative(ROOT, resolve(ROOT, dirname(file), match[1]))
      const candidate = exists(join(ROOT, dependency)) ? dependency : `${dependency}.ts`
      if (exists(join(ROOT, candidate)) && lstatSync(join(ROOT, candidate)).isFile()) visit(candidate)
    }
  }
  for (const file of ['convex/lib/learnV2ScorerConfig.ts', 'server/utils/learn-v2-mastery-scorer.ts', 'shared/learn-v2-measurement.ts']) visit(file)
  return {
    node: process.versions.node,
    repositoryCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    files: Object.fromEntries([...files].sort().map(file => [file, hash(readFileSync(join(ROOT, file)))])),
  }
}
