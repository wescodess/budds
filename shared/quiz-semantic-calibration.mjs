const SHA256_PATTERN = /^[a-f0-9]{64}$/
const LABELS = ['fully_correct', 'partially_correct', 'incorrect', 'uncertain']
const ARTIFACT_PATHS = Object.freeze({
  report: 'workers/laya-evaluator/calibration/report.json',
  thresholds: 'workers/laya-evaluator/calibration/thresholds.json',
  fit: 'workers/laya-evaluator/calibration/fit.v1.jsonl',
  heldout: 'workers/laya-evaluator/calibration/heldout.v1.jsonl',
  evaluationManifest: 'workers/laya-evaluator/learningDecisionManifest.json',
  calibrator: 'workers/laya-evaluator/calibration/probability-calibrator.v1.json',
})

export const ACTIVATION_DIAGNOSTICS = Object.freeze({
  ENABLED: 'enabled',
  MODE_OFF: 'mode_off',
  MANIFEST_NOT_APPROVED: 'manifest_not_approved',
  MANIFEST_VERSION_MISMATCH: 'manifest_version_mismatch',
  INVALID_MANIFEST: 'invalid_manifest',
  EVIDENCE_MISSING: 'evidence_missing',
  EVIDENCE_HASH_MISMATCH: 'evidence_hash_mismatch',
  THRESHOLDS_MISSING: 'thresholds_missing',
  THRESHOLDS_HASH_MISMATCH: 'thresholds_hash_mismatch',
  THRESHOLDS_MISMATCH: 'thresholds_mismatch',
  ARTIFACT_MISMATCH: 'artifact_mismatch',
  INVALID_REPORT: 'invalid_report',
  FAKE_BACKEND: 'fake_backend',
  INCOMPLETE_PROBABILITIES: 'incomplete_probabilities',
  PIN_MISMATCH: 'pin_mismatch',
  THRESHOLD_FAILED: 'threshold_failed',
  PROVENANCE_REJECTED: 'provenance_rejected',
  DEPLOYMENT_MISMATCH: 'deployment_mismatch',
  PRODUCTION_FORBIDDEN: 'production_forbidden',
})

function disabled(code, detail) {
  return { enabled: false, code, detail }
}

function finiteProbability(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function exactObject(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every(key => keys.includes(key))
}

function validMetrics(metrics) {
  if (!exactObject(metrics, ['sampleCount', 'referenceAgreement', 'macroF1', 'brierScore', 'ece', 'probabilityCompleteness', 'perLabel'])) return false
  if (!Number.isSafeInteger(metrics.sampleCount) || metrics.sampleCount < 1) return false
  if (![metrics.referenceAgreement, metrics.macroF1, metrics.brierScore, metrics.ece, metrics.probabilityCompleteness].every(finiteProbability)) return false
  if (!exactObject(metrics.perLabel, LABELS)) return false
  return LABELS.every((label) => {
    const row = metrics.perLabel[label]
    return exactObject(row, ['support', 'precision', 'recall', 'f1'])
      && Number.isSafeInteger(row.support) && row.support >= 0
      && [row.precision, row.recall, row.f1].every(finiteProbability)
  })
}

function validStatistics(statistics) {
  if (!exactObject(statistics, ['confusionMatrix', 'calibrationBins', 'completeProbabilityRows', 'brierSum'])) return false
  if (!exactObject(statistics.confusionMatrix, LABELS)) return false
  if (!LABELS.every(actual => exactObject(statistics.confusionMatrix[actual], LABELS)
    && LABELS.every(predicted => Number.isSafeInteger(statistics.confusionMatrix[actual][predicted]) && statistics.confusionMatrix[actual][predicted] >= 0))) return false
  return Array.isArray(statistics.calibrationBins) && statistics.calibrationBins.length === 10
    && statistics.calibrationBins.every(bin => exactObject(bin, ['count', 'confidenceSum', 'correctCount'])
      && Number.isSafeInteger(bin.count) && bin.count >= 0 && typeof bin.confidenceSum === 'number' && Number.isFinite(bin.confidenceSum) && bin.confidenceSum >= 0
      && Number.isSafeInteger(bin.correctCount) && bin.correctCount >= 0 && bin.correctCount <= bin.count)
    && Number.isSafeInteger(statistics.completeProbabilityRows) && statistics.completeProbabilityRows >= 0
    && typeof statistics.brierSum === 'number' && Number.isFinite(statistics.brierSum) && statistics.brierSum >= 0
}

function metricsFromStatistics(statistics) {
  const confusion = statistics.confusionMatrix
  const count = LABELS.reduce((total, actual) => total + LABELS.reduce((sum, predicted) => sum + confusion[actual][predicted], 0), 0)
  const correct = LABELS.reduce((sum, label) => sum + confusion[label][label], 0)
  const perLabel = Object.fromEntries(LABELS.map((label) => {
    const support = LABELS.reduce((sum, predicted) => sum + confusion[label][predicted], 0)
    const predicted = LABELS.reduce((sum, actual) => sum + confusion[actual][label], 0)
    const precision = predicted ? confusion[label][label] / predicted : 0
    const recall = support ? confusion[label][label] / support : 0
    return [label, { support, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0 }]
  }))
  const complete = statistics.completeProbabilityRows
  return {
    sampleCount: count,
    referenceAgreement: count ? correct / count : 0,
    macroF1: LABELS.reduce((sum, label) => sum + perLabel[label].f1, 0) / LABELS.length,
    brierScore: complete ? statistics.brierSum / complete : 1,
    ece: complete ? statistics.calibrationBins.reduce((sum, bin) => sum + (bin.count / complete) * Math.abs((bin.correctCount / (bin.count || 1)) - (bin.confidenceSum / (bin.count || 1))), 0) : 1,
    probabilityCompleteness: count ? complete / count : 0,
    perLabel,
  }
}

function metricsEqual(left, right) {
  const close = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-12
  return left.sampleCount === right.sampleCount
    && ['referenceAgreement', 'macroF1', 'brierScore', 'ece', 'probabilityCompleteness'].every(key => close(left[key], right[key]))
    && LABELS.every(label => left.perLabel[label].support === right.perLabel[label].support
      && ['precision', 'recall', 'f1'].every(key => close(left.perLabel[label][key], right.perLabel[label][key])))
}

function validThresholds(thresholds) {
  return exactObject(thresholds, ['version', 'minimumSampleCount', 'minimumPerLabelSupport', 'minimumReferenceAgreement', 'minimumMacroF1', 'maximumBrierScore', 'maximumEce', 'requiredProbabilityCompleteness'])
    && typeof thresholds.version === 'string' && thresholds.version.length > 0
    && Number.isSafeInteger(thresholds.minimumSampleCount) && thresholds.minimumSampleCount >= 1
    && Number.isSafeInteger(thresholds.minimumPerLabelSupport) && thresholds.minimumPerLabelSupport >= 1
    && [thresholds.minimumReferenceAgreement, thresholds.minimumMacroF1, thresholds.maximumBrierScore, thresholds.maximumEce, thresholds.requiredProbabilityCompleteness].every(finiteProbability)
}

function validCalibrator(calibrator, manifest) {
  if (!exactObject(manifest.pins, ['provider', 'packageVersion', 'modelRevision', 'modelSha256', 'contractVersion', 'snapshotVersion', 'rubricVersion', 'thresholdVersion'])) return false
  if (!exactObject(calibrator, ['schemaVersion', 'status', 'method', 'labels', 'bounds', 'epsilon', 'fitCorpus', 'pins', 'fitResult'])) return false
  if (calibrator.schemaVersion !== 'budds.laya-semantic-temperature-calibrator.v1'
    || calibrator.status !== 'fitted'
    || calibrator.method !== 'multiclass_temperature_scaling'
    || calibrator.epsilon !== 1e-12
    || !Array.isArray(calibrator.labels)
    || calibrator.labels.length !== LABELS.length
    || LABELS.some((label, index) => calibrator.labels[index] !== label)) return false
  if (!exactObject(calibrator.bounds, ['minimumTemperature', 'maximumTemperature'])
    || calibrator.bounds.minimumTemperature !== 0.05
    || calibrator.bounds.maximumTemperature !== 10) return false
  if (!exactObject(calibrator.fitCorpus, ['path', 'version', 'sha256'])
    || calibrator.fitCorpus.path !== manifest.corpora.fit.path
    || calibrator.fitCorpus.version !== manifest.corpora.fit.version
    || calibrator.fitCorpus.sha256 !== manifest.corpora.fit.sha256) return false
  if (!exactObject(calibrator.pins, ['packageVersion', 'modelRevision', 'modelSha256', 'evaluationManifestSha256'])
    || calibrator.pins.packageVersion !== manifest.pins.packageVersion
    || calibrator.pins.modelRevision !== manifest.pins.modelRevision
    || calibrator.pins.modelSha256 !== manifest.pins.modelSha256
    || calibrator.pins.evaluationManifestSha256 !== manifest.evaluationManifest.sha256) return false
  if (!exactObject(calibrator.fitResult, ['temperature', 'negativeLogLikelihood', 'iterations'])) return false
  return typeof calibrator.fitResult.temperature === 'number'
    && Number.isFinite(calibrator.fitResult.temperature)
    && calibrator.fitResult.temperature >= calibrator.bounds.minimumTemperature
    && calibrator.fitResult.temperature <= calibrator.bounds.maximumTemperature
    && typeof calibrator.fitResult.negativeLogLikelihood === 'number'
    && Number.isFinite(calibrator.fitResult.negativeLogLikelihood)
    && calibrator.fitResult.negativeLogLikelihood >= 0
    && Number.isSafeInteger(calibrator.fitResult.iterations)
    && calibrator.fitResult.iterations >= 1
}

function validReport(report) {
  return exactObject(report, ['schemaVersion', 'reportId', 'generatedAt', 'corpus', 'evaluationManifest', 'calibrator', 'execution', 'provenance', 'pins', 'thresholdArtifact', 'rawMetrics', 'rawStatistics', 'metrics', 'statistics', 'thresholds', 'passed'])
    && report.schemaVersion === 'budds.quiz-semantic-calibration-report.v2'
    && typeof report.reportId === 'string' && report.reportId.length > 0
    && typeof report.generatedAt === 'string' && !Number.isNaN(Date.parse(report.generatedAt))
    && exactObject(report.corpus, ['path', 'version', 'sha256', 'sampleCount'])
    && typeof report.corpus.path === 'string' && typeof report.corpus.version === 'string' && SHA256_PATTERN.test(report.corpus.sha256)
    && report.corpus.sampleCount === report.metrics?.sampleCount
    && exactObject(report.evaluationManifest, ['path', 'sha256']) && SHA256_PATTERN.test(report.evaluationManifest.sha256)
    && exactObject(report.calibrator, ['path', 'sha256']) && SHA256_PATTERN.test(report.calibrator.sha256)
    && exactObject(report.execution, ['requestTimeoutMs', 'timeoutOverride', 'operationalParityProven'])
    && Number.isSafeInteger(report.execution.requestTimeoutMs) && report.execution.requestTimeoutMs > 0
    && typeof report.execution.timeoutOverride === 'boolean' && report.execution.operationalParityProven === false
    && exactObject(report.provenance, ['tier', 'referenceSource', 'evaluatorBackend', 'containsRawLearnerData'])
    && report.provenance.tier === 'synthetic_reference'
    && report.provenance.referenceSource === 'versioned_synthetic_policy'
    && (report.provenance.evaluatorBackend === 'real' || report.provenance.evaluatorBackend === 'fake')
    && report.provenance.containsRawLearnerData === false
    && exactObject(report.pins, ['provider', 'packageVersion', 'modelRevision', 'modelSha256', 'contractVersion', 'snapshotVersion', 'rubricVersion'])
    && Object.values(report.pins).every(value => typeof value === 'string' && value.length > 0)
    && validMetrics(report.rawMetrics) && validStatistics(report.rawStatistics) && metricsEqual(report.rawMetrics, metricsFromStatistics(report.rawStatistics))
    && validMetrics(report.metrics) && validStatistics(report.statistics) && metricsEqual(report.metrics, metricsFromStatistics(report.statistics))
    && exactObject(report.thresholdArtifact, ['path', 'sha256'])
    && typeof report.thresholdArtifact.path === 'string' && SHA256_PATTERN.test(report.thresholdArtifact.sha256)
    && validThresholds(report.thresholds)
    && typeof report.passed === 'boolean'
}

function reportPassesItsThresholds(report) {
  const { metrics, thresholds } = report
  return metrics.sampleCount >= thresholds.minimumSampleCount
    && LABELS.every(label => metrics.perLabel[label].support >= thresholds.minimumPerLabelSupport)
    && metrics.referenceAgreement >= thresholds.minimumReferenceAgreement
    && metrics.macroF1 >= thresholds.minimumMacroF1
    && metrics.brierScore <= thresholds.maximumBrierScore
    && metrics.ece <= thresholds.maximumEce
    && metrics.probabilityCompleteness >= thresholds.requiredProbabilityCompleteness
}

export function verifyQuizSemanticActivation({ mode, configuredManifestVersion, manifest, report, reportSha256, thresholds, thresholdsSha256, artifactSha256 = {}, calibrator, deployment }) {
  if (mode !== 'advisory') return disabled(ACTIVATION_DIAGNOSTICS.MODE_OFF, 'Advisory mode is not selected.')
  if (!manifest || typeof manifest !== 'object') return disabled(ACTIVATION_DIAGNOSTICS.INVALID_MANIFEST, 'Activation manifest is unavailable.')
  if (manifest.status !== 'approved' || !Array.isArray(manifest.allowedModes) || !manifest.allowedModes.includes('advisory')) {
    return disabled(ACTIVATION_DIAGNOSTICS.MANIFEST_NOT_APPROVED, 'The committed activation policy is not approved for advisory mode.')
  }
  if (configuredManifestVersion !== manifest.manifestVersion) return disabled(ACTIVATION_DIAGNOSTICS.MANIFEST_VERSION_MISMATCH, 'Configured manifest version does not match the committed policy.')
  if (!exactObject(manifest.evidence, ['reportPath', 'sha256'])
    || manifest.evidence.reportPath !== ARTIFACT_PATHS.report || !SHA256_PATTERN.test(manifest.evidence.sha256)) {
    return disabled(ACTIVATION_DIAGNOSTICS.INVALID_MANIFEST, 'The evidence path or digest is invalid.')
  }
  if (!exactObject(manifest.thresholds, ['path', 'sha256'])
    || manifest.thresholds.path !== ARTIFACT_PATHS.thresholds || !SHA256_PATTERN.test(manifest.thresholds.sha256)) {
    return disabled(ACTIVATION_DIAGNOSTICS.INVALID_MANIFEST, 'The threshold policy path or digest is invalid.')
  }
  if (!exactObject(manifest.corpora, ['fit', 'heldout'])
    || !['fit', 'heldout'].every(name => exactObject(manifest.corpora[name], ['path', 'version', 'sha256'])
      && manifest.corpora[name].path === ARTIFACT_PATHS[name] && typeof manifest.corpora[name].version === 'string'
      && manifest.corpora[name].version.length > 0 && SHA256_PATTERN.test(manifest.corpora[name].sha256))
    || !exactObject(manifest.evaluationManifest, ['path', 'sha256']) || manifest.evaluationManifest.path !== ARTIFACT_PATHS.evaluationManifest || !SHA256_PATTERN.test(manifest.evaluationManifest.sha256)
    || !exactObject(manifest.calibrator, ['path', 'sha256', 'status']) || manifest.calibrator.path !== ARTIFACT_PATHS.calibrator || !SHA256_PATTERN.test(manifest.calibrator.sha256)) {
    return disabled(ACTIVATION_DIAGNOSTICS.INVALID_MANIFEST, 'Corpus, evaluator-manifest, or calibrator pins are invalid.')
  }
  if (!report || !reportSha256) return disabled(ACTIVATION_DIAGNOSTICS.EVIDENCE_MISSING, 'The committed calibration report is missing.')
  if (reportSha256 !== manifest.evidence.sha256) return disabled(ACTIVATION_DIAGNOSTICS.EVIDENCE_HASH_MISMATCH, 'The calibration report digest does not match the activation policy.')
  if (!thresholds || !thresholdsSha256) return disabled(ACTIVATION_DIAGNOSTICS.THRESHOLDS_MISSING, 'The committed threshold policy is missing.')
  if (thresholdsSha256 !== manifest.thresholds.sha256) return disabled(ACTIVATION_DIAGNOSTICS.THRESHOLDS_HASH_MISMATCH, 'The threshold policy digest does not match the activation manifest.')
  if (!validThresholds(thresholds)) return disabled(ACTIVATION_DIAGNOSTICS.THRESHOLDS_MISMATCH, 'The committed threshold policy is invalid.')
  if (!validReport(report)) return disabled(ACTIVATION_DIAGNOSTICS.INVALID_REPORT, 'The calibration report does not satisfy the v2 schema or recomputed statistics.')
  if (manifest.calibrator.status !== 'fitted' || !validCalibrator(calibrator, manifest)
    || artifactSha256.fit !== manifest.corpora.fit.sha256
    || artifactSha256.heldout !== manifest.corpora.heldout.sha256
    || artifactSha256.evaluationManifest !== manifest.evaluationManifest.sha256
    || artifactSha256.calibrator !== manifest.calibrator.sha256
    || report.corpus.path !== manifest.corpora.heldout.path || report.corpus.version !== manifest.corpora.heldout.version || report.corpus.sha256 !== artifactSha256.heldout
    || report.evaluationManifest.path !== manifest.evaluationManifest.path || report.evaluationManifest.sha256 !== artifactSha256.evaluationManifest
    || report.calibrator.path !== manifest.calibrator.path || report.calibrator.sha256 !== artifactSha256.calibrator) {
    return disabled(ACTIVATION_DIAGNOSTICS.ARTIFACT_MISMATCH, 'Calibration artifacts do not match the committed fit, held-out, evaluator, and calibrator pins.')
  }
  if (report.thresholdArtifact.path !== manifest.thresholds.path || report.thresholdArtifact.sha256 !== thresholdsSha256
    || Object.keys(thresholds).some(key => report.thresholds[key] !== thresholds[key])) {
    return disabled(ACTIVATION_DIAGNOSTICS.THRESHOLDS_MISMATCH, 'The report does not embed the exact committed threshold policy.')
  }
  if (report.provenance.evaluatorBackend !== 'real') return disabled(ACTIVATION_DIAGNOSTICS.FAKE_BACKEND, 'Fake evaluator output cannot activate advisory mode.')
  if (report.metrics.probabilityCompleteness !== 1) return disabled(ACTIVATION_DIAGNOSTICS.INCOMPLETE_PROBABILITIES, 'Every calibration decision must contain a complete probability distribution.')
  if (!exactObject(manifest.pins, ['provider', 'packageVersion', 'modelRevision', 'modelSha256', 'contractVersion', 'snapshotVersion', 'rubricVersion', 'thresholdVersion'])
    || !Array.isArray(manifest.requiredLabels) || manifest.requiredLabels.length !== LABELS.length
    || LABELS.some((label, index) => manifest.requiredLabels[index] !== label)
    || Object.entries(report.pins).some(([key, value]) => manifest.pins[key] !== value)
    || thresholds.version !== manifest.pins.thresholdVersion) {
    return disabled(ACTIVATION_DIAGNOSTICS.PIN_MISMATCH, 'The report does not match the pinned evaluator, contract, rubric, or threshold policy.')
  }
  if (report.provenance.tier !== manifest.minimumProvenanceTier) return disabled(ACTIVATION_DIAGNOSTICS.PROVENANCE_REJECTED, 'Evidence provenance is not eligible for this environment.')
  if (!report.passed || !reportPassesItsThresholds(report)) return disabled(ACTIVATION_DIAGNOSTICS.THRESHOLD_FAILED, 'Calibration metrics do not meet the development thresholds.')
  if (!deployment || deployment.applicationEnvironment === 'production' || deployment.pagesEnvironment === 'production') {
    return disabled(ACTIVATION_DIAGNOSTICS.PRODUCTION_FORBIDDEN, 'Synthetic reference evidence is never eligible for production.')
  }
  const expected = manifest.deployment
  if (!exactObject(expected, ['applicationEnvironment', 'pagesEnvironment', 'pagesBranch', 'convexUrl'])
    || deployment.applicationEnvironment !== expected.applicationEnvironment
    || deployment.pagesEnvironment !== expected.pagesEnvironment
    || deployment.pagesBranch !== expected.pagesBranch
    || deployment.convexUrl !== expected.convexUrl) {
    return disabled(ACTIVATION_DIAGNOSTICS.DEPLOYMENT_MISMATCH, 'Runtime deployment identity does not match the approved development tuple.')
  }
  return { enabled: true, code: ACTIVATION_DIAGNOSTICS.ENABLED, detail: 'Verified synthetic-reference development beta.' }
}

export function calculateCalibrationEvidence(rows) {
  const confusion = Object.fromEntries(LABELS.map(actual => [actual, Object.fromEntries(LABELS.map(predicted => [predicted, 0]))]))
  let correct = 0
  let brier = 0
  let complete = 0
  const bins = Array.from({ length: 10 }, () => ({ count: 0, confidence: 0, correct: 0 }))
  for (const row of rows) {
    confusion[row.expectedLabel][row.label] += 1
    const isCorrect = row.expectedLabel === row.label ? 1 : 0
    correct += isCorrect
    const probabilities = row.probabilities
    const probabilityKeys = probabilities && Object.keys(probabilities)
    const isComplete = probabilityKeys?.length === LABELS.length && LABELS.every(label => finiteProbability(probabilities[label]))
      && Math.abs(LABELS.reduce((sum, label) => sum + probabilities[label], 0) - 1) <= 0.001
    if (isComplete) {
      complete += 1
      brier += LABELS.reduce((sum, label) => sum + (probabilities[label] - (label === row.expectedLabel ? 1 : 0)) ** 2, 0) / LABELS.length
      const confidence = probabilities[row.label]
      const bin = bins[Math.min(9, Math.floor(confidence * 10))]
      bin.count += 1; bin.confidence += confidence; bin.correct += isCorrect
    }
  }
  const perLabel = Object.fromEntries(LABELS.map((label) => {
    const tp = confusion[label][label]
    const support = LABELS.reduce((sum, predicted) => sum + confusion[label][predicted], 0)
    const predicted = LABELS.reduce((sum, actual) => sum + confusion[actual][label], 0)
    const precision = predicted ? tp / predicted : 0
    const recall = support ? tp / support : 0
    const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0
    return [label, { support, precision, recall, f1 }]
  }))
  const count = rows.length
  const metrics = {
    sampleCount: count,
    referenceAgreement: count ? correct / count : 0,
    macroF1: LABELS.reduce((sum, label) => sum + perLabel[label].f1, 0) / LABELS.length,
    brierScore: complete ? brier / complete : 1,
    ece: complete ? bins.reduce((sum, bin) => sum + (bin.count / complete) * Math.abs((bin.correct / (bin.count || 1)) - (bin.confidence / (bin.count || 1))), 0) : 1,
    probabilityCompleteness: count ? complete / count : 0,
    perLabel,
  }
  return {
    metrics,
    statistics: {
      confusionMatrix: confusion,
      calibrationBins: bins.map(bin => ({ count: bin.count, confidenceSum: bin.confidence, correctCount: bin.correct })),
      completeProbabilityRows: complete,
      brierSum: brier,
    },
  }
}

export function calculateCalibrationMetrics(rows) {
  return calculateCalibrationEvidence(rows).metrics
}

export function applyTemperature(probabilities, temperature) {
  if (!Number.isFinite(temperature) || temperature < 0.05 || temperature > 10) throw new Error('Temperature must be within [0.05, 10].')
  const powered = Object.fromEntries(LABELS.map(label => [label, Math.exp(Math.log(Math.max(probabilities[label], 1e-12)) / temperature)]))
  const total = Object.values(powered).reduce((sum, value) => sum + value, 0)
  return Object.fromEntries(LABELS.map(label => [label, powered[label] / total]))
}

export function fitTemperature(rows) {
  const objective = temperature => rows.reduce((sum, row) => sum - Math.log(Math.max(applyTemperature(row.probabilities, temperature)[row.expectedLabel], 1e-12)), 0) / rows.length
  const ratio = (Math.sqrt(5) - 1) / 2
  let left = 0.05
  let right = 10
  let c = right - ratio * (right - left)
  let d = left + ratio * (right - left)
  let fc = objective(c)
  let fd = objective(d)
  for (let iteration = 0; iteration < 128; iteration += 1) {
    if (fc <= fd) {
      right = d; d = c; fd = fc; c = right - ratio * (right - left); fc = objective(c)
    }
    else {
      left = c; c = d; fc = fd; d = left + ratio * (right - left); fd = objective(d)
    }
  }
  const temperature = (left + right) / 2
  return { temperature, nllBefore: objective(1), nllAfter: objective(temperature), iterations: 128, bounds: [0.05, 10] }
}

export const CALIBRATION_LABELS = Object.freeze([...LABELS])
