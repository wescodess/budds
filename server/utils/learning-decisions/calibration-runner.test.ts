import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, describe, expect, test } from 'vitest'

const projectRoot = process.cwd()
const runner = path.join(projectRoot, 'scripts/evaluate-laya-calibration.mjs')
const labels = ['fully_correct', 'partially_correct', 'incorrect', 'uncertain'] as const
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Laya calibration artifacts and runner', () => {
  test('keeps the frozen corpus deterministic with 800 held-out rows and 200 per label', async () => {
    const result = await run(process.execPath, ['scripts/generate-laya-calibration-corpus.mjs'])
    expect(result).toMatchObject({ code: 0 })
    const rows = (await readFile(path.join(projectRoot, 'workers/laya-evaluator/calibration/heldout.v1.jsonl'), 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line))
    const fitRows = (await readFile(path.join(projectRoot, 'workers/laya-evaluator/calibration/fit.v1.jsonl'), 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line))
    expect(rows).toHaveLength(800)
    expect(fitRows).toHaveLength(800)
    expect(new Set(rows.map(row => row.scenarioId)).size).toBe(50)
    expect(new Set(fitRows.map(row => row.scenarioId)).size).toBe(50)
    expect(new Set(rows.map(row => `${row.question}\0${row.expectedAnswer}\0${row.evidenceExcerpt}`)))
      .not.toEqual(new Set(fitRows.map(row => `${row.question}\0${row.expectedAnswer}\0${row.evidenceExcerpt}`)))
    const fitText = new Set(fitRows.map(row => `${row.question}\0${row.expectedAnswer}\0${row.evidenceExcerpt}`.toLowerCase()))
    expect(rows.some(row => fitText.has(`${row.question}\0${row.expectedAnswer}\0${row.evidenceExcerpt}`.toLowerCase()))).toBe(false)
    const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const fitAnswers = new Set(fitRows.map(row => normalize(row.expectedAnswer)))
    expect(rows.some(row => fitAnswers.has(normalize(row.expectedAnswer)))).toBe(false)
    expect(Object.fromEntries(labels.map(label => [label, rows.filter(row => row.expectedLabel === label).length])))
      .toEqual(Object.fromEntries(labels.map(label => [label, 200])))
    for (const scenarioId of new Set(rows.map(row => row.scenarioId))) {
      const exact = rows.filter(row => row.scenarioId === scenarioId && row.expectedLabel === 'fully_correct' && row.learnerAnswer === row.expectedAnswer)
      expect(exact.length).toBeLessThanOrEqual(1)
    }
    const committedCases = rows.map(row => row.learnerAnswer)
    expect(committedCases).toEqual(expect.arrayContaining([
      'culture and opportunities',
      'opportunities & cultures',
      'opportunities, culture',
      'cultures & opportunity',
      'culture and salary',
      'no cultures and no opportunities',
      'cultured and opportunities',
      'culture and opportunitieses',
    ]))
  })

  test('honors Retry-After, completes within the attempt bound, and binds the threshold bytes', { timeout: 10_000 }, async () => {
    const fixture = await writeFixture(32_000)
    let attempts = 0
    const server = createServer((request, response) => {
      attempts += 1
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { raw += chunk })
      request.on('end', () => {
        if (attempts === 1) {
          response.writeHead(429, { 'Retry-After': '0' }).end('{}')
          return
        }
        const body = JSON.parse(raw)
        const decisions = body.items.map((item: { id: string }, index: number) => ({
          id: item.id,
          label: labels[index],
          confidence: 1,
          probabilities: Object.fromEntries(labels.map(label => [label, label === labels[index] ? 1 : 0])),
        }))
        response.writeHead(200, { 'Content-Type': 'application/json', ...fixture.provenanceHeaders })
          .end(JSON.stringify({ status: 'completed', provider: 'laya', modelRevision: fixture.manifest.model.revision, decisions }))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected an IPv4 test listener.')
    try {
      const result = await run(process.execPath, [runner], fixture.environment(`http://127.0.0.1:${address.port}`))
      expect(result).toMatchObject({ code: 0 })
      expect(attempts).toBe(2)
      const report = JSON.parse(await readFile(fixture.output, 'utf8'))
      expect(report).toMatchObject({
        passed: true,
        corpus: { sampleCount: 4 },
        thresholdArtifact: { path: 'workers/laya-evaluator/calibration/thresholds.json', sha256: fixture.thresholdsSha256 },
        evaluationManifest: { sha256: fixture.manifestSha256 },
        execution: { requestTimeoutMs: 777, timeoutOverride: true },
        pins: {
          packageVersion: fixture.manifest.model.packageVersion,
          modelRevision: fixture.manifest.model.revision,
          modelSha256: fixture.manifest.model.sha256,
        },
        metrics: { probabilityCompleteness: 1 },
      })
      expect(Object.values(report.metrics.perLabel).map((entry: any) => entry.support)).toEqual([1, 1, 1, 1])
    }
    finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  test('requires fresh service attestation even when a complete provenance-bound resume is present', async () => {
    const fixture = await writeFixture(32_000)
    await writeFile(fixture.resume, `${JSON.stringify({
      schemaVersion: 'budds.quiz-semantic-calibration-resume.v2',
      phase: 'heldout',
      corpusSha256: fixture.corpusSha256,
      thresholdsSha256: fixture.thresholdsSha256,
      evaluationManifestSha256: fixture.manifestSha256,
      requestTimeoutMs: 777,
      serviceProvenance: fixture.serviceProvenance,
      decisions: labels.map((label, index) => ({
        id: `heldout-${String(index + 1).padStart(3, '0')}`,
        expectedLabel: label,
        label,
        confidence: 1,
        backend: 'real',
        probabilities: Object.fromEntries(labels.map(candidate => [candidate, candidate === label ? 1 : 0])),
      })),
    }, null, 2)}\n`)
    let evaluatedItems = 0
    const server = createServer((request, response) => {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { raw += chunk })
      request.on('end', () => {
        const body = JSON.parse(raw)
        evaluatedItems += body.items.length
        const decisions = body.items.map((item: { id: string }, index: number) => ({
          id: item.id,
          label: labels[index],
          confidence: 1,
          probabilities: Object.fromEntries(labels.map(label => [label, label === labels[index] ? 1 : 0])),
        }))
        response.writeHead(200, { 'Content-Type': 'application/json', ...fixture.provenanceHeaders })
          .end(JSON.stringify({ status: 'completed', provider: 'laya', modelRevision: fixture.manifest.model.revision, decisions }))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected an IPv4 test listener.')
    try {
      const result = await run(process.execPath, [runner], fixture.environment(`http://127.0.0.1:${address.port}`))
      expect(result.code).toBe(0)
      expect(evaluatedItems).toBe(4)
    }
    finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  test('emits deterministic fit bytes from the rounded stored temperature', async () => {
    const first = await writeFixture(32_000, 'fit')
    const second = await writeFixture(32_000, 'fit')
    const server = createServer((request, response) => {
      let raw = ''
      request.setEncoding('utf8')
      request.on('data', chunk => { raw += chunk })
      request.on('end', () => {
        const body = JSON.parse(raw)
        const decisions = body.items.map((item: { id: string }, index: number) => ({
          id: item.id,
          label: labels[index],
          confidence: 0.7,
          probabilities: Object.fromEntries(labels.map(label => [label, label === labels[index] ? 0.7 : 0.1])),
        }))
        response.writeHead(200, { 'Content-Type': 'application/json', ...first.provenanceHeaders })
          .end(JSON.stringify({ status: 'completed', provider: 'laya', modelRevision: first.manifest.model.revision, decisions }))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected an IPv4 test listener.')
    try {
      expect((await run(process.execPath, [runner], first.environment(`http://127.0.0.1:${address.port}`))).code).toBe(0)
      expect((await run(process.execPath, [runner], second.environment(`http://127.0.0.1:${address.port}`))).code).toBe(0)
      const firstBytes = await readFile(first.output, 'utf8')
      expect(await readFile(second.output, 'utf8')).toBe(firstBytes)
      const artifact = JSON.parse(firstBytes)
      expect(artifact.fitResult.temperature).toBe(Number(artifact.fitResult.temperature.toFixed(12)))
      const calibratedExpected = 0.7 ** (1 / artifact.fitResult.temperature)
      const calibratedOther = 0.1 ** (1 / artifact.fitResult.temperature)
      const expectedNll = -Math.log(calibratedExpected / (calibratedExpected + 3 * calibratedOther))
      expect(artifact.fitResult.negativeLogLikelihood).toBeCloseTo(expectedNll, 15)
    }
    finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  test('rejects an oversized serialized request before provider traffic', async () => {
    const fixture = await writeFixture(1)
    const result = await run(process.execPath, [runner], fixture.environment('http://127.0.0.1:1'))
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('above the pinned 1-byte limit')
    await expect(readFile(fixture.output, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('stops after the pinned retry-attempt bound without emitting evidence', async () => {
    const fixture = await writeFixture(32_000)
    let attempts = 0
    const server = createServer((_request, response) => {
      attempts += 1
      response.writeHead(503, { 'Retry-After': '0' }).end('{}')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected an IPv4 test listener.')
    try {
      const result = await run(process.execPath, [runner], fixture.environment(`http://127.0.0.1:${address.port}`))
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('exhausted 3 attempts after HTTP 503')
      expect(attempts).toBe(3)
      await expect(readFile(fixture.output, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    }
    finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})

async function writeFixture(requestBytes: number, phase: 'fit' | 'heldout' = 'heldout') {
  const directory = await mkdtemp(path.join(tmpdir(), 'budds-laya-calibration-'))
  temporaryDirectories.push(directory)
  const baseManifest = JSON.parse(await readFile(path.join(projectRoot, 'workers/laya-evaluator/learningDecisionManifest.json'), 'utf8'))
  const manifest = {
    ...baseManifest,
    limits: { ...baseManifest.limits, semanticBatchSize: 4, requestBytes },
    retry: { ...baseManifest.retry, maxAttempts: 3, baseDelayMs: 1, retryAfterMinMs: 1, retryAfterMaxMs: 5 },
    timeouts: { ...baseManifest.timeouts, clientDeadlineMs: 1_000 },
  }
  const corpus = labels.map((label, index) => ({
    id: `${phase}-${String(index + 1).padStart(3, '0')}`,
    expectedLabel: label,
    scenarioId: `${phase}-scenario-${String(index + 1).padStart(3, '0')}`,
    question: `Question ${index + 1}?`,
    questionType: 'free-response',
    expectedAnswer: `Expected ${index + 1}`,
    learnerAnswer: `Learner ${index + 1}`,
    evidenceExcerpt: `Evidence ${index + 1}`,
    language: 'en',
  }))
  const thresholds = {
    version: 'test-thresholds.v1',
    minimumSampleCount: 4,
    minimumPerLabelSupport: 1,
    minimumReferenceAgreement: 1,
    minimumMacroF1: 1,
    maximumBrierScore: 0,
    maximumEce: 0,
    requiredProbabilityCompleteness: 1,
  }
  const paths = {
    corpus: path.join(directory, 'corpus.jsonl'),
    thresholds: path.join(directory, 'thresholds.json'),
    manifest: path.join(directory, 'manifest.json'),
    output: path.join(directory, 'report.json'),
    resume: path.join(directory, 'resume.json'),
    calibrator: path.join(directory, 'calibrator.json'),
  }
  const thresholdBytes = `${JSON.stringify(thresholds, null, 2)}\n`
  const corpusBytes = `${corpus.map(row => JSON.stringify(row)).join('\n')}\n`
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`
  const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex')
  const calibrator = {
    schemaVersion: 'budds.laya-semantic-temperature-calibrator.v1', status: 'fitted', labels,
    method: 'multiclass_temperature_scaling',
    bounds: { minimumTemperature: 0.05, maximumTemperature: 10 }, epsilon: 1e-12,
    fitCorpus: { path: 'workers/laya-evaluator/calibration/fit.v1.jsonl', version: 'quiz-semantic-fit.v1', sha256: 'f'.repeat(64) },
    pins: { packageVersion: manifest.model.packageVersion, modelRevision: manifest.model.revision, modelSha256: manifest.model.sha256, evaluationManifestSha256: manifestSha256 },
    fitResult: { temperature: 1, negativeLogLikelihood: 0.5, iterations: 128 },
  }
  const calibratorBytes = `${JSON.stringify(calibrator, null, 2)}\n`
  const calibratorSha256 = createHash('sha256').update(calibratorBytes).digest('hex')
  await Promise.all([
    writeFile(paths.corpus, corpusBytes),
    writeFile(paths.thresholds, thresholdBytes),
    writeFile(paths.manifest, manifestBytes),
    writeFile(paths.calibrator, calibratorBytes),
  ])
  return {
    ...paths,
    manifest,
    corpusSha256: createHash('sha256').update(corpusBytes).digest('hex'),
    manifestSha256,
    thresholdsSha256: createHash('sha256').update(thresholdBytes).digest('hex'),
    provenanceHeaders: {
      'X-Laya-Evidence-Backend': 'real',
      ...(phase === 'fit' ? { 'X-Laya-Calibration-Mode': 'fit', 'X-Laya-Calibrator-Status': 'raw-fit' } : { 'X-Laya-Calibrator-Status': 'valid' }),
      'X-Laya-Package-Version': manifest.model.packageVersion,
      'X-Laya-Model-Revision': manifest.model.revision,
      'X-Laya-Model-SHA256': manifest.model.sha256,
      'X-Laya-Evaluation-Manifest-SHA256': manifestSha256,
      ...(phase === 'heldout' ? { 'X-Laya-Calibrator-SHA256': calibratorSha256 } : {}),
    },
    serviceProvenance: {
      backend: 'real', calibrationMode: phase === 'fit' ? 'fit' : null, calibratorStatus: phase === 'fit' ? 'raw-fit' : 'valid',
      packageVersion: manifest.model.packageVersion, modelRevision: manifest.model.revision,
      modelSha256: manifest.model.sha256, evaluationManifestSha256: manifestSha256, calibratorSha256: phase === 'fit' ? null : calibratorSha256,
    },
    environment: (url: string) => ({
      LAYA_CALIBRATION_PHASE: phase,
      LAYA_CALIBRATION_CORPUS: paths.corpus,
      LAYA_CALIBRATION_THRESHOLDS: paths.thresholds,
      LAYA_CALIBRATION_MANIFEST: paths.manifest,
      LAYA_CALIBRATION_CALIBRATOR: paths.calibrator,
      LAYA_CALIBRATION_REPORT: paths.output,
      LAYA_CALIBRATION_RESUME: paths.resume,
      LAYA_CALIBRATION_URL: url,
      LAYA_CALIBRATION_TOKEN: 'test-only-calibration-token-000000000',
      LAYA_CALIBRATION_GENERATED_AT: '2026-09-20T00:00:00.000Z',
      LAYA_CALIBRATION_TIMEOUT_MS: '777',
    }),
  }
}

function run(command: string, args: string[], environment: Record<string, string> = {}) {
  return new Promise<{ code: number | null, stdout: string, stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, env: { ...process.env, ...environment } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}
