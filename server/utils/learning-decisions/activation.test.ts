import { describe, expect, test } from 'vitest'
import {
  bundledQuizSemanticActivationDecision,
  isQuizSemanticAdvisoryEnabled,
  isQuizSemanticShadowEnabled,
  QUIZ_SEMANTIC_ACTIVATION_MANIFEST_VERSION,
} from './activation'
import { applyTemperature, calculateCalibrationMetrics, fitTemperature, verifyQuizSemanticActivation } from '../../../shared/quiz-semantic-calibration.mjs'

const hash = 'a'.repeat(64)
const deployment = { applicationEnvironment: 'development', pagesEnvironment: 'preview', pagesBranch: 'dev', convexUrl: 'https://cautious-elephant-39.convex.cloud' }
const pins = {
  provider: 'laya', packageVersion: '0.3.3', modelRevision: 'revision', modelSha256: 'b'.repeat(64),
  contractVersion: 'contract', snapshotVersion: 'snapshot', rubricVersion: 'rubric',
}
const thresholds = { version: 'threshold-v1', minimumSampleCount: 800, minimumPerLabelSupport: 200, minimumReferenceAgreement: 0.8, minimumMacroF1: 0.75, maximumBrierScore: 0.2, maximumEce: 0.2, requiredProbabilityCompleteness: 1 }
const metrics = {
  sampleCount: 800, referenceAgreement: 1, macroF1: 1, brierScore: 0, ece: 0, probabilityCompleteness: 1,
  perLabel: Object.fromEntries(['fully_correct', 'partially_correct', 'incorrect', 'uncertain'].map(label => [label, { support: 200, precision: 1, recall: 1, f1: 1 }])),
}
const statistics = {
  confusionMatrix: Object.fromEntries(['fully_correct', 'partially_correct', 'incorrect', 'uncertain'].map(actual => [actual, Object.fromEntries(['fully_correct', 'partially_correct', 'incorrect', 'uncertain'].map(predicted => [predicted, actual === predicted ? 200 : 0]))])),
  calibrationBins: Array.from({ length: 10 }, (_, index) => ({ count: index === 9 ? 800 : 0, confidenceSum: index === 9 ? 800 : 0, correctCount: index === 9 ? 800 : 0 })),
  completeProbabilityRows: 800,
  brierSum: 0,
}
const calibrator = {
  schemaVersion: 'budds.laya-semantic-temperature-calibrator.v1', status: 'fitted', method: 'multiclass_temperature_scaling',
  labels: ['fully_correct', 'partially_correct', 'incorrect', 'uncertain'],
  bounds: { minimumTemperature: 0.05, maximumTemperature: 10 }, epsilon: 1e-12,
  fitCorpus: { path: 'workers/laya-evaluator/calibration/fit.v1.jsonl', version: 'fit-v1', sha256: hash },
  pins: { packageVersion: pins.packageVersion, modelRevision: pins.modelRevision, modelSha256: pins.modelSha256, evaluationManifestSha256: hash },
  fitResult: { temperature: 1.5, negativeLogLikelihood: 0.75, iterations: 128 },
}
const report = {
  schemaVersion: 'budds.quiz-semantic-calibration-report.v2', reportId: 'report', generatedAt: '2026-09-20T00:00:00.000Z',
  corpus: { path: 'workers/laya-evaluator/calibration/heldout.v1.jsonl', version: 'heldout-v1', sha256: hash, sampleCount: 800 },
  evaluationManifest: { path: 'workers/laya-evaluator/learningDecisionManifest.json', sha256: hash },
  calibrator: { path: 'workers/laya-evaluator/calibration/probability-calibrator.v1.json', sha256: hash },
  execution: { requestTimeoutMs: 120_000, timeoutOverride: true, operationalParityProven: false },
  provenance: { tier: 'synthetic_reference', referenceSource: 'versioned_synthetic_policy', evaluatorBackend: 'real', containsRawLearnerData: false },
  pins, rawMetrics: metrics, rawStatistics: statistics, metrics, statistics, thresholdArtifact: { path: 'workers/laya-evaluator/calibration/thresholds.json', sha256: hash }, thresholds, passed: true,
}
const manifest = {
  manifestVersion: 'activation-v1', status: 'approved', allowedModes: ['off', 'shadow', 'advisory'],
  evidence: { reportPath: 'workers/laya-evaluator/calibration/report.json', sha256: hash },
  thresholds: { path: 'workers/laya-evaluator/calibration/thresholds.json', sha256: hash },
  corpora: { fit: { path: 'workers/laya-evaluator/calibration/fit.v1.jsonl', version: 'fit-v1', sha256: hash }, heldout: { path: 'workers/laya-evaluator/calibration/heldout.v1.jsonl', version: 'heldout-v1', sha256: hash } },
  evaluationManifest: { path: 'workers/laya-evaluator/learningDecisionManifest.json', sha256: hash },
  calibrator: { path: 'workers/laya-evaluator/calibration/probability-calibrator.v1.json', sha256: hash, status: 'fitted' },
  minimumProvenanceTier: 'synthetic_reference', requiredLabels: ['fully_correct', 'partially_correct', 'incorrect', 'uncertain'],
  pins: { ...pins, thresholdVersion: 'threshold-v1' }, deployment,
}

function verify(overrides: Record<string, unknown> = {}) {
  return verifyQuizSemanticActivation({ mode: 'advisory', configuredManifestVersion: 'activation-v1', manifest, report, reportSha256: hash, thresholds, thresholdsSha256: hash, artifactSha256: { fit: hash, heldout: hash, evaluationManifest: hash, calibrator: hash }, calibrator, deployment, ...overrides })
}

describe('quiz semantic activation boundary', () => {
  test('allows hidden shadow execution only on the development dev-preview boundary', () => {
    expect(isQuizSemanticShadowEnabled('shadow', deployment)).toBe(true)
    expect(isQuizSemanticShadowEnabled('advisory', deployment)).toBe(false)
    expect(isQuizSemanticShadowEnabled('shadow', { ...deployment, applicationEnvironment: 'production' })).toBe(false)
    expect(isQuizSemanticShadowEnabled('shadow', { ...deployment, pagesEnvironment: 'production' })).toBe(false)
    expect(isQuizSemanticShadowEnabled('shadow', { ...deployment, pagesBranch: 'feature' })).toBe(false)
    expect(isQuizSemanticShadowEnabled('shadow', { ...deployment, pagesEnvironment: '', pagesBranch: '' })).toBe(false)
  })

  test('keeps learner advisory mode disabled without approved calibration evidence', () => {
    expect(QUIZ_SEMANTIC_ACTIVATION_MANIFEST_VERSION).toBe('quiz-semantic-advisory.v1')
    expect(isQuizSemanticAdvisoryEnabled('off', QUIZ_SEMANTIC_ACTIVATION_MANIFEST_VERSION)).toBe(false)
    expect(isQuizSemanticAdvisoryEnabled('shadow', QUIZ_SEMANTIC_ACTIVATION_MANIFEST_VERSION)).toBe(false)
    expect(isQuizSemanticAdvisoryEnabled('advisory', QUIZ_SEMANTIC_ACTIVATION_MANIFEST_VERSION)).toBe(false)
    expect(bundledQuizSemanticActivationDecision('advisory', QUIZ_SEMANTIC_ACTIVATION_MANIFEST_VERSION, deployment))
      .toMatchObject({ enabled: false, code: 'manifest_not_approved' })
  })

  test('accepts only the exact passing development tuple', () => {
    expect(verify()).toMatchObject({ enabled: true, code: 'enabled' })
    expect(verify({ deployment: { ...deployment, pagesBranch: 'feature' } })).toMatchObject({ enabled: false, code: 'deployment_mismatch' })
    expect(verify({ deployment: { ...deployment, applicationEnvironment: 'production' } })).toMatchObject({ enabled: false, code: 'production_forbidden' })
  })

  test.each([
    ['evidence_hash_mismatch', { reportSha256: 'd'.repeat(64) }],
    ['fake_backend', { report: { ...report, provenance: { ...report.provenance, evaluatorBackend: 'fake' } } }],
    ['invalid_report', { report: { ...report, metrics: { ...metrics, probabilityCompleteness: 0.95 } } }],
    ['pin_mismatch', { report: { ...report, pins: { ...pins, modelRevision: 'drifted' } } }],
    ['invalid_report', { report: { ...report, metrics: { ...metrics, referenceAgreement: 0.5 }, passed: true } }],
    ['invalid_report', { report: { ...report, metrics: { ...metrics, perLabel: { ...metrics.perLabel, uncertain: { ...metrics.perLabel.uncertain, support: 199 } } }, passed: true } }],
    ['thresholds_hash_mismatch', { thresholdsSha256: 'e'.repeat(64) }],
    ['thresholds_mismatch', { report: { ...report, thresholds: { ...thresholds, minimumMacroF1: 0.1 } } }],
    ['artifact_mismatch', { artifactSha256: { fit: hash, heldout: 'e'.repeat(64), evaluationManifest: hash, calibrator: hash } }],
    ['artifact_mismatch', { calibrator: { ...calibrator, method: 'identity' } }],
    ['artifact_mismatch', { calibrator: { ...calibrator, pins: { ...calibrator.pins, modelRevision: 'locally-asserted' } } }],
    ['artifact_mismatch', { calibrator: { ...calibrator, fitResult: { ...calibrator.fitResult, temperature: 11 } } }],
    ['invalid_manifest', { manifest: { ...manifest, corpora: { ...manifest.corpora, fit: { ...manifest.corpora.fit, path: '../fit.v1.jsonl' } } } }],
    ['invalid_manifest', { manifest: { ...manifest, evaluationManifest: { ...manifest.evaluationManifest, path: 'workers/laya-evaluator/calibration/learningDecisionManifest.json' } } }],
  ])('fails closed with typed diagnostic %s', (code, overrides) => {
    expect(verify(overrides)).toMatchObject({ enabled: false, code })
  })

  test('calculates reference, per-label, probability, Brier, and calibration metrics independently', () => {
    const rows = ['fully_correct', 'partially_correct', 'incorrect', 'uncertain'].map(label => ({
      expectedLabel: label,
      label,
      probabilities: Object.fromEntries(['fully_correct', 'partially_correct', 'incorrect', 'uncertain'].map(candidate => [candidate, candidate === label ? 1 : 0])),
    }))
    expect(calculateCalibrationMetrics(rows)).toMatchObject({ sampleCount: 4, referenceAgreement: 1, macroF1: 1, brierScore: 0, ece: 0, probabilityCompleteness: 1 })
  })

  test('fits temperature deterministically and matches the Python parity vector', () => {
    const parity = { fully_correct: 0.64, partially_correct: 0.16, incorrect: 0.16, uncertain: 0.04 }
    Object.values(applyTemperature(parity, 2)).forEach((value, index) => expect(value).toBeCloseTo([4 / 9, 2 / 9, 2 / 9, 1 / 9][index]!, 12))
    const probabilities = { fully_correct: 0.7, partially_correct: 0.2, incorrect: 0.1, uncertain: 1e-12 }
    const rows = Array.from({ length: 8 }, (_, index) => ({ expectedLabel: index % 2 ? 'partially_correct' : 'fully_correct', probabilities }))
    expect(fitTemperature(rows)).toEqual({
      temperature: 1.4872267392717977,
      nllBefore: 0.9830564281874163,
      nllAfter: 0.9523586845116183,
      iterations: 128,
      bounds: [0.05, 10],
    })
  })
})
