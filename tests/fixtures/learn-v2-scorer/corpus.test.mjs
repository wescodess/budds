import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { proveResponse, summarizeCorpus } from '../../../scripts/learn-v2-scorer-corpus.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const cli = join(root, 'scripts/learn-v2-scorer-corpus.mjs')

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8' })
}

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'learn-v2-scorer-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('the offline corpus CLI regenerates 224 source-proven responses in disjoint 112/112 splits', async (t) => {
  const directory = await workspace(t)
  const first = join(directory, 'first')
  const second = join(directory, 'second')
  for (const output of [first, second]) {
    const result = run('generate', '--output', output)
    assert.equal(result.status, 0, result.stderr)
  }
  for (const file of ['corpus.v1.json', 'manifest.v1.json']) {
    assert.equal(await readFile(join(first, file), 'utf8'), await readFile(join(second, file), 'utf8'))
    assert.equal(await readFile(join(first, file), 'utf8'), await readFile(join(root, 'tests/fixtures/learn-v2-scorer', file), 'utf8'))
  }
  const corpus = JSON.parse(await readFile(join(first, 'corpus.v1.json'), 'utf8'))
  assert.equal(corpus.evidenceStatus, 'offline_contract_only')
  assert.equal(corpus.core.length, 224)
  assert.equal(corpus.core.filter(row => row.split === 'fit').length, 112)
  assert.equal(corpus.core.filter(row => row.split === 'heldout').length, 112)
  assert.equal(new Set(corpus.core.map(row => row.domain)).size, 8)
  assert.equal(new Set(corpus.core.map(row => row.packetId)).size, 16)
  assert.equal(new Set(corpus.core.map(row => `${row.packetId}/${row.formId}`)).size, 32)
  for (const seedClass of ['correct', 'paraphrase', 'partial', 'misconception', 'plausible_wrong', 'off_topic', 'injection']) {
    assert.equal(corpus.core.filter(row => row.seedClass === seedClass).length, 32)
  }
  const verified = run('verify', '--output', first)
  assert.equal(verified.status, 0, verified.stderr)
})

test('all seed vectors come from source proofs and an essential-atom mutation fails verification', async (t) => {
  const directory = await workspace(t)
  assert.equal(run('generate', '--output', directory).status, 0)
  const file = join(directory, 'corpus.v1.json')
  const corpus = JSON.parse(await readFile(file, 'utf8'))
  const vectors = {
    correct: [true, true, true],
    paraphrase: [true, true, true],
    partial: [true, false, true],
    misconception: [false, true, true],
    plausible_wrong: [false, false, true],
    off_topic: [false, false, false],
    injection: [false, true, true],
  }
  for (const row of corpus.core) {
    assert.deepEqual(Object.values(row.expected.criteria), vectors[row.seedClass])
    assert.equal(row.expected.referencePass, ['correct', 'paraphrase'].includes(row.seedClass))
    assert.equal(row.expected.proof.length, 3)
    assert.ok(row.expected.proof.every(atom => atom.sourcePointers.length > 0))
  }
  const partial = corpus.core.find(row => row.packetId === 'linear-balance' && row.formId === 'A' && row.seedClass === 'partial')
  assert.deepEqual(partial.expected.criteria, { solution: true, scaled: false, quotient: true })
  assert.equal(partial.expected.referencePass, false)
  const correct = corpus.core.find(row => row.packetId === 'linear-balance' && row.formId === 'A' && row.seedClass === 'correct')
  assert.equal(correct.response, 'The isolated x is 12.\nThe scaled offset is 21.\nThe division result is 12.')
  correct.response = correct.response.replace('scaled offset is 21', 'scaled offset is 20')
  await writeFile(file, `${JSON.stringify(corpus, null, 2)}\n`)
  const result = run('verify', '--output', directory)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Source proof mismatch/)
})

test('verification detects cross-split source families, claim families and normalized duplicates', async (t) => {
  const directory = await workspace(t)
  assert.equal(run('generate', '--output', directory).status, 0)
  const file = join(directory, 'corpus.v1.json')
  const original = JSON.parse(await readFile(file, 'utf8'))
  for (const [mutation, error] of [
    [(fit, heldout) => { heldout.sourceFamilyId = fit.sourceFamilyId }, /Cross-split source family leakage/],
    [(fit, heldout) => { heldout.claimFamilyIds[0] = fit.claimFamilyIds[0] }, /Cross-split claim family leakage/],
    [(fit, heldout) => { heldout.response = fit.response.toUpperCase().replaceAll(' ', '  ') }, /Cross-split normalized duplicate/],
  ]) {
    const corpus = structuredClone(original)
    mutation(corpus.core.find(row => row.split === 'fit'), corpus.core.find(row => row.split === 'heldout'))
    await writeFile(file, `${JSON.stringify(corpus, null, 2)}\n`)
    const result = run('verify', '--output', directory)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, error)
  }
})

test('eight positive injection controls, twenty repeats and four diagnostic slots stay outside core denominators', async (t) => {
  const directory = await workspace(t)
  assert.equal(run('generate', '--output', directory).status, 0)
  const corpus = JSON.parse(await readFile(join(directory, 'corpus.v1.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.v1.json'), 'utf8'))
  assert.equal(corpus.controls.length, 8)
  assert.equal(new Set(corpus.controls.map(row => row.domain)).size, 8)
  assert.ok(corpus.controls.every(row => row.expected.referencePass && Object.values(row.expected.criteria).every(Boolean)))
  assert.equal(corpus.repeats.length, 20)
  assert.equal(corpus.diagnostics.length, 4)
  for (const repeat of corpus.repeats) {
    const original = corpus.core.find(row => row.id === repeat.repeatOf)
    assert.ok(original)
    assert.equal(repeat.response, original.response)
    assert.deepEqual(repeat.expected, original.expected)
  }
  assert.ok([...corpus.controls, ...corpus.repeats, ...corpus.diagnostics].every(row => row.split === 'fit'))
  assert.equal(manifest.counts.dispatchesPerModel, 256)
  const expected = {
    fit: { referencePositive: 32, referenceNegative: 80 },
    heldout: { referencePositive: 32, referenceNegative: 80 },
    total: { referencePositive: 64, referenceNegative: 160 },
  }
  assert.deepEqual(manifest.coreDenominators, expected)
  assert.deepEqual(summarizeCorpus(corpus).coreDenominators, expected)
  corpus.controls.push(...corpus.controls)
  corpus.repeats.push(...corpus.repeats)
  assert.deepEqual(summarizeCorpus(corpus).coreDenominators, expected)
  await writeFile(join(directory, 'corpus.v1.json'), `${JSON.stringify(corpus, null, 2)}\n`)
  const inflated = run('verify', '--output', directory)
  assert.notEqual(inflated.status, 0)
  assert.match(inflated.stderr, /dispatch accounting|Frozen corpus artifact mismatch/)
})

test('generation rejects unavailable rights, unaccepted sources and source/claim leakage before producing gold', async (t) => {
  const directory = await workspace(t)
  const inputs = join(directory, 'inputs')
  await mkdir(inputs)
  const originalSources = JSON.parse(await readFile(join(root, 'tests/fixtures/learn-v2-scorer/sources.v1.json'), 'utf8'))
  const originalSplits = JSON.parse(await readFile(join(root, 'tests/fixtures/learn-v2-scorer/splits.v1.json'), 'utf8'))
  for (const [mutation, error] of [
    [(sources) => { sources.rights.status = 'unknown' }, /Source rights\/test acceptance unavailable/],
    [(sources) => { sources.acceptance.status = 'pending' }, /Source rights\/test acceptance unavailable/],
    [(sources) => { sources.packets[1].source = structuredClone(sources.packets[0].source) }, /Cross-split source snapshot leakage/],
    [(sources) => { sources.packets[1].claimFamilyIds[0] = sources.packets[0].claimFamilyIds[0] }, /Cross-split claim family leakage/],
    [(sources) => { sources.packets[0].atoms[0].query.op = 'add' }, /Key constraint is not bound to its source claim/],
    [(sources) => { sources.packets[0].source.records.total = '19' }, /Numeric source operands must be finite numbers/],
    [(sources) => {
      const source = sources.packets[0]
      const target = sources.packets[1]
      target.source.records.total = source.source.records.total
      target.source.records.offset = source.source.records.offset
      target.atoms[0].query = structuredClone(source.atoms[0].query)
      target.source.claims[target.atoms[0].sourceClaimId].query = structuredClone(source.atoms[0].query)
    }, /Cross-split executable claim leakage/],
    [(_sources, splits) => { splits.families[1].split = 'fit' }, /one fit and one heldout source packet per domain/],
  ]) {
    const sources = structuredClone(originalSources)
    const splits = structuredClone(originalSplits)
    mutation(sources, splits)
    await writeFile(join(inputs, 'sources.v1.json'), `${JSON.stringify(sources, null, 2)}\n`)
    await writeFile(join(inputs, 'splits.v1.json'), `${JSON.stringify(splits, null, 2)}\n`)
    const result = run('generate', '--inputs', inputs, '--output', join(directory, 'output'))
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, error)
  }
})

test('gold includes unit errors, near numeric errors, false relations, negation and ordering; arbitrary prose stays exploratory', async (t) => {
  const directory = await workspace(t)
  assert.equal(run('generate', '--output', directory).status, 0)
  const { core } = JSON.parse(await readFile(join(directory, 'corpus.v1.json'), 'utf8'))
  assert.deepEqual([...new Set(core.flatMap(row => row.expected.proof.map(atom => atom.kind)))].sort(), ['keyed', 'numeric', 'order', 'proposition', 'relation'])
  const near = core.find(row => row.packetId === 'linear-balance' && row.formId === 'A' && row.seedClass === 'plausible_wrong')
  assert.equal(near.expected.proof[1].observedValue.value, 22)
  const unit = core.find(row => row.packetId === 'motion-case' && row.formId === 'A' && row.seedClass === 'misconception')
  assert.equal(unit.expected.proof[0].observedValue.value, 4)
  assert.equal(unit.expected.proof[0].observedValue.unit, 'seconds')
  assert.equal(unit.expected.proof[0].satisfied, false)
  const relation = core.find(row => row.packetId === 'food-model' && row.formId === 'A' && row.seedClass === 'misconception')
  assert.equal(relation.expected.proof[0].observedValue, 'leaf')
  assert.equal(relation.expected.proof[0].outcome, 'contradicted')
  const sources = JSON.parse(await readFile(join(root, 'tests/fixtures/learn-v2-scorer/sources.v1.json'), 'utf8'))
  const packet = sources.packets[0]
  const correct = core.find(row => row.packetId === packet.id && row.formId === 'A' && row.seedClass === 'correct')
  assert.throws(() => proveResponse(packet, packet.forms[0], `${correct.response}\nA persuasive claim with no executable proof.`), /Unprovable prose is exploratory/)
  assert.throws(() => proveResponse(packet, packet.forms[0], `${correct.response}\nThe isolated x is 99.`), /Ambiguous repeated atom/)
})

test('sealed artifact pins cover public inputs, keys, rubric, form, response, generator, seed and research', async (t) => {
  const directory = await workspace(t)
  assert.equal(run('generate', '--output', directory).status, 0)
  const manifestFile = join(directory, 'manifest.v1.json')
  const corpusFile = join(directory, 'corpus.v1.json')
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  for (const [name, file] of [
    ['sourcesSha256', 'tests/fixtures/learn-v2-scorer/sources.v1.json'],
    ['splitsSha256', 'tests/fixtures/learn-v2-scorer/splits.v1.json'],
    ['generatorSha256', 'scripts/learn-v2-scorer-corpus.mjs'],
    ['lockfileSha256', 'pnpm-lock.yaml'],
  ]) {
    assert.equal(manifest.hashes[name], createHash('sha256').update(await readFile(join(root, file))).digest('hex'))
  }
  const corpus = JSON.parse(await readFile(corpusFile, 'utf8'))
  assert.ok(corpus.core.every(row => Object.values(row.pins).every(value => /^[0-9a-f]{64}$/.test(value))))
  assert.equal(manifest.contract.researchCommit, 'c1740a662eef13214d682531e37cebc8f6b1014d')
  assert.equal(manifest.contract.researchSha256, createHash('sha256').update(await readFile(join(root, 'docs/research/learn-anything-scorer-harness.md'))).digest('hex'))
  assert.equal(manifest.policy.fullMeasurementSequence, 'requires_three_distinct_cases')
  assert.equal(manifest.policy.thresholds, 'provisional')
  manifest.hashes.seedSha256 = '0'.repeat(64)
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
  const stale = run('verify', '--output', directory)
  assert.notEqual(stale.status, 0)
  assert.match(stale.stderr, /Frozen corpus artifact mismatch: manifest/)
  assert.equal(run('generate', '--output', directory).status, 0)
  corpus.core[0].pins.keySha256 = '0'.repeat(64)
  await writeFile(corpusFile, `${JSON.stringify(corpus, null, 2)}\n`)
  const key = run('verify', '--output', directory)
  assert.notEqual(key.status, 0)
  assert.match(key.stderr, /Source\/key\/rubric\/form\/response pin mismatch/)
})
