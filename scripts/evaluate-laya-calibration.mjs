import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { applyTemperature, calculateCalibrationEvidence, CALIBRATION_LABELS, fitTemperature } from './lib/quiz-semantic-calibration.mjs'

const root = process.cwd()
const calibrationDirectory = path.join(root, 'workers/laya-evaluator/calibration')
const phase = process.env.LAYA_CALIBRATION_PHASE || 'heldout'
if (phase !== 'fit' && phase !== 'heldout') throw new Error('LAYA_CALIBRATION_PHASE must be fit or heldout.')
const corpusFilename = phase === 'fit' ? 'fit.v1.jsonl' : 'heldout.v1.jsonl'
const corpusPath = path.resolve(root, process.env.LAYA_CALIBRATION_CORPUS || path.join(calibrationDirectory, corpusFilename))
const thresholdsPath = path.resolve(root, process.env.LAYA_CALIBRATION_THRESHOLDS || path.join(calibrationDirectory, 'thresholds.json'))
const manifestPath = path.resolve(root, process.env.LAYA_CALIBRATION_MANIFEST || path.join(root, 'workers/laya-evaluator/learningDecisionManifest.json'))
const calibratorPath = path.resolve(root, process.env.LAYA_CALIBRATION_CALIBRATOR || path.join(calibrationDirectory, 'probability-calibrator.v1.json'))
const outputPath = path.resolve(root, process.env.LAYA_CALIBRATION_REPORT || path.join(calibrationDirectory, phase === 'fit' ? 'probability-calibrator.candidate.json' : 'report.candidate.json'))
const resumePath = path.resolve(root, process.env.LAYA_CALIBRATION_RESUME || path.join(calibrationDirectory, `.${phase}-report-work.json`))
const evaluatorUrl = process.env.LAYA_CALIBRATION_URL || process.env.NUXT_LAYA_EVALUATOR_URL
const evaluatorToken = process.env.LAYA_CALIBRATION_TOKEN || process.env.NUXT_LAYA_EVALUATOR_TOKEN
const generatedAt = process.env.LAYA_CALIBRATION_GENERATED_AT
const timeoutOverride = process.env.LAYA_CALIBRATION_TIMEOUT_MS

if (!evaluatorUrl || !evaluatorToken || evaluatorToken.length < 32 || !generatedAt || Number.isNaN(Date.parse(generatedAt))) {
  throw new Error('Set LAYA_CALIBRATION_URL, LAYA_CALIBRATION_TOKEN (32+ characters), and deterministic LAYA_CALIBRATION_GENERATED_AT.')
}

const [corpusBytes, thresholdsBytes, manifestBytes] = await Promise.all([
  fs.readFile(corpusPath), fs.readFile(thresholdsPath), fs.readFile(manifestPath),
])
const manifest = JSON.parse(manifestBytes.toString('utf8'))
const thresholds = JSON.parse(thresholdsBytes.toString('utf8'))
const corpus = corpusBytes.toString('utf8').trim().split('\n').filter(Boolean).map((line, index) => {
  try { return JSON.parse(line) }
  catch { throw new Error(`Calibration corpus row ${index + 1} is invalid JSON.`) }
})
const corpusHash = sha256(corpusBytes)
const thresholdsHash = sha256(thresholdsBytes)
const evaluationManifestHash = sha256(manifestBytes)
const corpusVersion = `quiz-semantic-${phase}.v1`
const requestTimeoutMs = timeoutOverride === undefined ? manifest.timeouts.clientDeadlineMs : Number(timeoutOverride)
if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120_000) throw new Error('LAYA_CALIBRATION_TIMEOUT_MS must be an integer from 1 through 120000.')
const rubric = manifest.decisionKinds.freeResponse.rubric
const expectedLabels = new Set(CALIBRATION_LABELS)

for (const row of corpus) {
  const allowedKeys = ['id', 'expectedLabel', 'scenarioId', 'question', 'questionType', 'expectedAnswer', 'learnerAnswer', 'evidenceExcerpt', 'language']
  if (!row || Object.keys(row).length !== allowedKeys.length || Object.keys(row).some(key => !allowedKeys.includes(key))
    || typeof row.id !== 'string' || !new RegExp(`^${phase}-[0-9]{3}$`).test(row.id) || !expectedLabels.has(row.expectedLabel)
    || typeof row.scenarioId !== 'string' || !new RegExp(`^${phase}-scenario-[0-9]{3}$`).test(row.scenarioId)
    || !['free-response', 'fill_in_the_blank'].includes(row.questionType)
    || row.language !== 'en'
    || !['question', 'expectedAnswer', 'learnerAnswer', 'evidenceExcerpt'].every(key => typeof row[key] === 'string' && row[key].length > 0)
    || row.question.length > manifest.limits.questionChars || row.expectedAnswer.length > manifest.limits.optionChars
    || row.learnerAnswer.length > manifest.limits.learnerAnswerChars || row.evidenceExcerpt.length > manifest.limits.evidenceChars) {
    throw new Error('Calibration corpus does not match the frozen synthetic v1 shape.')
  }
}
if (new Set(corpus.map(row => row.id)).size !== corpus.length) throw new Error('Calibration corpus IDs must be unique.')
const support = Object.fromEntries(CALIBRATION_LABELS.map(label => [label, corpus.filter(row => row.expectedLabel === label).length]))
if (corpus.length < thresholds.minimumSampleCount
  || CALIBRATION_LABELS.some(label => support[label] < thresholds.minimumPerLabelSupport)) {
  throw new Error(`Calibration corpus support is below policy: ${JSON.stringify({ sampleCount: corpus.length, support })}`)
}

let completed = new Map()
let serviceProvenance = null
try {
  const resumed = JSON.parse(await fs.readFile(resumePath, 'utf8'))
  if (resumed.schemaVersion === 'budds.quiz-semantic-calibration-resume.v2'
    && resumed.phase === phase
    && resumed.corpusSha256 === corpusHash
    && resumed.thresholdsSha256 === thresholdsHash
    && resumed.evaluationManifestSha256 === evaluationManifestHash
    && resumed.requestTimeoutMs === requestTimeoutMs
    && validServiceProvenance(resumed.serviceProvenance, phase)
    && Array.isArray(resumed.decisions)
    && new Set(resumed.decisions.map(row => row.id)).size === resumed.decisions.length
    && resumed.decisions.every(validCachedDecision)) {
    serviceProvenance = resumed.serviceProvenance
    completed = new Map(resumed.decisions.map(row => [row.id, row]))
  }
}
catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

// A resume file is never sufficient evidence by itself. Replay one full first
// batch so every invocation obtains a fresh authenticated service attestation.
if (completed.size > 0) {
  for (const row of corpus.slice(0, manifest.limits.semanticBatchSize)) completed.delete(row.id)
  serviceProvenance = null
}

const pending = corpus.filter(row => !completed.has(row.id))
for (let offset = 0; offset < pending.length; offset += manifest.limits.semanticBatchSize) {
  const batch = pending.slice(offset, offset + manifest.limits.semanticBatchSize)
  const items = batch.map(row => ({
    id: row.id,
    question: row.question,
    questionType: row.questionType,
    expectedAnswer: row.expectedAnswer,
    learnerAnswer: row.learnerAnswer,
    evidenceExcerpt: row.evidenceExcerpt,
    language: row.language,
    rubricVersion: manifest.decisionKinds.freeResponse.kind,
    rubric,
  }))
  const request = {
    kind: manifest.decisionKinds.freeResponse.kind,
    requestId: `calibration-${String(offset / manifest.limits.semanticBatchSize + 1).padStart(3, '0')}`,
    inputDigest: sha256(Buffer.from(JSON.stringify(items))),
    contractVersion: manifest.contractVersion,
    snapshotVersion: manifest.snapshotVersion,
    items,
  }
  const requestBody = JSON.stringify(request)
  const requestBytes = new TextEncoder().encode(requestBody).byteLength
  if (requestBytes > manifest.limits.requestBytes) {
    throw new Error(`Calibration request is ${requestBytes} bytes, above the pinned ${manifest.limits.requestBytes}-byte limit.`)
  }
  const response = await evaluateWithRetries(requestBody, requestBytes)
  const observed = readServiceProvenance(response)
  if (!validServiceProvenance(observed, phase)) throw new Error('Calibration response lacks valid observed real-service provenance.')
  if (serviceProvenance && JSON.stringify(serviceProvenance) !== JSON.stringify(observed)) throw new Error('Evaluator provenance changed during calibration.')
  serviceProvenance = observed
  const payload = await response.json()
  if (payload.status !== 'completed' || payload.provider !== manifest.model.provider || payload.modelRevision !== manifest.model.revision
    || !Array.isArray(payload.decisions) || payload.decisions.length !== batch.length) {
    throw new Error('Evaluator response does not match the pinned calibration contract.')
  }
  const expectedById = new Map(batch.map(row => [row.id, row.expectedLabel]))
  for (const decision of payload.decisions) {
    if (!expectedById.has(decision.id) || !expectedLabels.has(decision.label)) throw new Error('Evaluator returned an unknown decision.')
    const keys = decision.probabilities && Object.keys(decision.probabilities)
    if (keys?.length !== CALIBRATION_LABELS.length || !CALIBRATION_LABELS.every(label => typeof decision.probabilities[label] === 'number')) {
      throw new Error('Every real-model calibration row must include all label probabilities.')
    }
    completed.set(decision.id, { id: decision.id, expectedLabel: expectedById.get(decision.id), label: decision.label, confidence: decision.confidence, probabilities: decision.probabilities, backend: observed.backend })
  }
  await fs.writeFile(resumePath, `${JSON.stringify({
    schemaVersion: 'budds.quiz-semantic-calibration-resume.v2',
    phase,
    corpusSha256: corpusHash,
    thresholdsSha256: thresholdsHash,
    evaluationManifestSha256: evaluationManifestHash,
    requestTimeoutMs,
    serviceProvenance,
    decisions: [...completed.values()].sort((a, b) => a.id.localeCompare(b.id)),
  }, null, 2)}\n`, { mode: 0o600 })
}

const rows = corpus.map(row => completed.get(row.id))
if (rows.some(row => !row)) throw new Error('Calibration is incomplete; no report was emitted.')
if (!serviceProvenance) throw new Error('Calibration completed without observed service provenance.')
let artifact
if (phase === 'fit') {
  const fitted = fitTemperature(rows)
  const temperature = Number(fitted.temperature.toFixed(12))
  const negativeLogLikelihood = rows.reduce((sum, row) => (
    sum - Math.log(Math.max(applyTemperature(row.probabilities, temperature)[row.expectedLabel], 1e-12))
  ), 0) / rows.length
  artifact = {
    schemaVersion: 'budds.laya-semantic-temperature-calibrator.v1',
    status: 'fitted',
    labels: CALIBRATION_LABELS,
    method: 'multiclass_temperature_scaling',
    bounds: { minimumTemperature: 0.05, maximumTemperature: 10 },
    epsilon: 1e-12,
    fitCorpus: { path: 'workers/laya-evaluator/calibration/fit.v1.jsonl', version: corpusVersion, sha256: corpusHash },
    pins: {
      packageVersion: serviceProvenance.packageVersion,
      modelRevision: serviceProvenance.modelRevision,
      modelSha256: serviceProvenance.modelSha256,
      evaluationManifestSha256: evaluationManifestHash,
    },
    fitResult: { temperature, negativeLogLikelihood, iterations: fitted.iterations },
  }
}
else {
  const calibratorBytes = await fs.readFile(calibratorPath)
  const calibrator = JSON.parse(calibratorBytes.toString('utf8'))
  const calibratorSha256 = sha256(calibratorBytes)
  if (!validCalibrator(calibrator, calibratorSha256, serviceProvenance)) throw new Error('Held-out calibration requires the exact valid fitted calibrator observed by the service.')
  const calibrated = calculateCalibrationEvidence(rows)
  const rawRows = rows.map(row => ({ ...row, probabilities: applyTemperature(row.probabilities, 1 / calibrator.fitResult.temperature) }))
  const raw = calculateCalibrationEvidence(rawRows)
  const metrics = calibrated.metrics
  const passed = metrics.sampleCount >= thresholds.minimumSampleCount
    && CALIBRATION_LABELS.every(label => metrics.perLabel[label].support >= thresholds.minimumPerLabelSupport)
    && metrics.referenceAgreement >= thresholds.minimumReferenceAgreement
    && metrics.macroF1 >= thresholds.minimumMacroF1
    && metrics.brierScore <= thresholds.maximumBrierScore
    && metrics.ece <= thresholds.maximumEce
    && metrics.probabilityCompleteness >= thresholds.requiredProbabilityCompleteness
  artifact = {
    schemaVersion: 'budds.quiz-semantic-calibration-report.v2',
    reportId: `laya-${corpusHash.slice(0, 12)}-${manifest.model.revision.slice(0, 12)}`,
    generatedAt: new Date(generatedAt).toISOString(),
    corpus: { path: 'workers/laya-evaluator/calibration/heldout.v1.jsonl', version: corpusVersion, sha256: corpusHash, sampleCount: corpus.length },
    evaluationManifest: { path: 'workers/laya-evaluator/learningDecisionManifest.json', sha256: evaluationManifestHash },
    calibrator: { path: 'workers/laya-evaluator/calibration/probability-calibrator.v1.json', sha256: calibratorSha256 },
    execution: { requestTimeoutMs, timeoutOverride: timeoutOverride !== undefined, operationalParityProven: false },
    provenance: { tier: 'synthetic_reference', referenceSource: 'versioned_synthetic_policy', evaluatorBackend: serviceProvenance.backend, containsRawLearnerData: false },
    pins: {
      provider: manifest.model.provider,
      packageVersion: serviceProvenance.packageVersion,
      modelRevision: serviceProvenance.modelRevision,
      modelSha256: serviceProvenance.modelSha256,
      contractVersion: manifest.contractVersion,
      snapshotVersion: manifest.snapshotVersion,
      rubricVersion: manifest.decisionKinds.freeResponse.kind,
    },
    thresholdArtifact: { path: 'workers/laya-evaluator/calibration/thresholds.json', sha256: thresholdsHash },
    rawMetrics: raw.metrics,
    rawStatistics: raw.statistics,
    metrics: calibrated.metrics,
    statistics: calibrated.statistics,
    thresholds,
    passed,
  }
}
await fs.writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { flag: 'wx' })
await fs.rm(resumePath, { force: true })
process.stdout.write(`${JSON.stringify({ phase, artifact: path.relative(root, outputPath), sha256: sha256(Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`)), passed: artifact.passed, sampleCount: corpus.length })}\n`)

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function evaluateWithRetries(body, requestBytes) {
  let lastStatus = 0
  let lastError
  for (let attempt = 1; attempt <= manifest.retry.maxAttempts; attempt += 1) {
    try {
      const response = await fetch(new URL('/v1/evaluate', evaluatorUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${evaluatorToken}`,
          'Content-Type': 'application/json',
          'Content-Length': String(requestBytes),
        },
        body,
        signal: AbortSignal.timeout(requestTimeoutMs),
      })
      lastStatus = response.status
      if (response.ok) return response
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      if (!retryable || attempt === manifest.retry.maxAttempts) break
      await response.arrayBuffer().catch(() => undefined)
      await sleep(retryDelayMs(response.headers.get('Retry-After'), attempt))
    }
    catch (error) {
      lastError = error
      if (attempt === manifest.retry.maxAttempts) break
      await sleep(retryDelayMs(null, attempt))
    }
  }
  const detail = lastStatus ? `HTTP ${lastStatus}` : lastError instanceof Error ? lastError.name : 'network failure'
  throw new Error(`Evaluator exhausted ${manifest.retry.maxAttempts} attempts after ${detail}; no report was emitted.`)
}

function retryDelayMs(retryAfter, attempt) {
  let requested
  if (retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter.trim())) requested = Number(retryAfter) * 1000
  else if (retryAfter) requested = Date.parse(retryAfter) - Date.now()
  const fallback = manifest.retry.baseDelayMs * 2 ** (attempt - 1)
  const value = Number.isFinite(requested) ? requested : fallback
  return Math.min(manifest.retry.retryAfterMaxMs, Math.max(manifest.retry.retryAfterMinMs, value))
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function readServiceProvenance(response) {
  return {
    backend: response.headers.get('X-Laya-Evidence-Backend'),
    calibrationMode: response.headers.get('X-Laya-Calibration-Mode'),
    calibratorStatus: response.headers.get('X-Laya-Calibrator-Status'),
    packageVersion: response.headers.get('X-Laya-Package-Version'),
    modelRevision: response.headers.get('X-Laya-Model-Revision'),
    modelSha256: response.headers.get('X-Laya-Model-SHA256'),
    evaluationManifestSha256: response.headers.get('X-Laya-Evaluation-Manifest-SHA256'),
    calibratorSha256: response.headers.get('X-Laya-Calibrator-SHA256'),
  }
}

function validServiceProvenance(value, expectedPhase) {
  return value?.backend === 'real'
    && (expectedPhase === 'fit' ? value.calibrationMode === 'fit' && value.calibratorStatus === 'raw-fit' : value.calibrationMode === null && value.calibratorStatus === 'valid')
    && value.packageVersion === manifest.model.packageVersion
    && value.modelRevision === manifest.model.revision
    && value.modelSha256 === manifest.model.sha256
    && value.evaluationManifestSha256 === evaluationManifestHash
    && (expectedPhase === 'fit' ? value.calibratorSha256 === null : typeof value.calibratorSha256 === 'string' && /^[a-f0-9]{64}$/.test(value.calibratorSha256))
}

function validCachedDecision(row) {
  const expected = corpus.find(candidate => candidate.id === row?.id)
  return Boolean(expected)
    && row.expectedLabel === expected.expectedLabel
    && row.backend === 'real'
    && expectedLabels.has(row.label)
    && row.probabilities && Object.keys(row.probabilities).length === CALIBRATION_LABELS.length
    && CALIBRATION_LABELS.every(label => typeof row.probabilities[label] === 'number' && Number.isFinite(row.probabilities[label]) && row.probabilities[label] >= 0 && row.probabilities[label] <= 1)
    && Math.abs(CALIBRATION_LABELS.reduce((sum, label) => sum + row.probabilities[label], 0) - 1) <= 0.001
}

function validCalibrator(value, sha256Value, observed) {
  return value?.schemaVersion === 'budds.laya-semantic-temperature-calibrator.v1'
    && value.status === 'fitted'
    && value.method === 'multiclass_temperature_scaling'
    && value.epsilon === 1e-12
    && value.bounds?.minimumTemperature === 0.05 && value.bounds?.maximumTemperature === 10
    && Array.isArray(value.labels) && JSON.stringify(value.labels) === JSON.stringify(CALIBRATION_LABELS)
    && Number.isFinite(value.fitResult?.temperature) && value.fitResult.temperature >= 0.05 && value.fitResult.temperature <= 10
    && value.pins?.evaluationManifestSha256 === evaluationManifestHash
    && value.pins?.packageVersion === observed.packageVersion
    && value.pins?.modelRevision === observed.modelRevision
    && value.pins?.modelSha256 === observed.modelSha256
    && observed.calibratorSha256 === sha256Value
}
