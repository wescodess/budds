import { describe, expect, test } from 'vitest'
import manifest from '../learningDecisionManifest.json'
import { CONTRACT_VERSION, FREE_RESPONSE_ASSESSMENT_KIND, isEvaluation, isEvaluationRequest, MANIFEST_VERSION, MAX_BATCH_SIZE, MAX_ITEM_ID_CHARS, MAX_OPTION_COUNT, MAX_REQUEST_BYTES, MAX_REQUEST_ID_CHARS, MAX_SEMANTIC_BATCH_SIZE, PINNED_MODEL_REVISION, SNAPSHOT_VERSION } from './contracts'

describe('Laya evaluator DTO boundary', () => {
  const request = { kind: 'quiz_quality', requestId: 'r1', inputDigest: 'a'.repeat(64), contractVersion: CONTRACT_VERSION, snapshotVersion: SNAPSHOT_VERSION, items: [{ id: 'q1', question: 'What is ATP?', correctAnswer: 'Energy', options: ['Energy'], language: 'en', evidence: { sourceIndex: 0, excerpt: 'ATP transfers energy.' } }] }
  test('accepts the bounded canonical request and rejects invalid batches', () => {
    expect(isEvaluationRequest(request)).toBe(true)
    expect(isEvaluationRequest({ ...request, items: [] })).toBe(false)
    expect(isEvaluationRequest({ ...request, items: [request.items[0], request.items[0]] })).toBe(false)
    expect(MAX_REQUEST_BYTES).toBeLessThan(64_000)
    expect({ MANIFEST_VERSION, CONTRACT_VERSION, SNAPSHOT_VERSION, MAX_REQUEST_BYTES, MAX_BATCH_SIZE, MAX_SEMANTIC_BATCH_SIZE, MAX_REQUEST_ID_CHARS, MAX_ITEM_ID_CHARS, MAX_OPTION_COUNT, PINNED_MODEL_REVISION }).toEqual({
      MANIFEST_VERSION: manifest.manifestVersion,
      CONTRACT_VERSION: manifest.contractVersion,
      SNAPSHOT_VERSION: manifest.snapshotVersion,
      MAX_REQUEST_BYTES: manifest.limits.requestBytes,
      MAX_BATCH_SIZE: manifest.limits.qualityBatchSize,
      MAX_SEMANTIC_BATCH_SIZE: manifest.limits.semanticBatchSize,
      MAX_REQUEST_ID_CHARS: manifest.limits.requestIdChars,
      MAX_ITEM_ID_CHARS: manifest.limits.itemIdChars,
      MAX_OPTION_COUNT: manifest.limits.optionCount,
      PINNED_MODEL_REVISION: manifest.model.revision,
    })
    expect(manifest.supportedLanguages.every(language => isEvaluationRequest({
      ...request,
      items: [{ ...request.items[0], language: language.replace('*', 'CA') }],
    }))).toBe(true)
  })
  test('requires provider metadata and bounded confidences from the container', () => {
    expect(isEvaluation({ status: 'completed', provider: 'laya', modelRevision: 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2', decisions: [{ id: 'q1', label: 'supported', confidence: 1 }] }, 'quiz_quality')).toBe(true)
    expect(isEvaluation({ status: 'completed', provider: 'laya', modelRevision: 'wrong', decisions: [{ id: 'q1', label: 'supported', confidence: 1 }] }, 'quiz_quality')).toBe(false)
    expect(isEvaluation({ status: 'completed', provider: 'laya', modelRevision: 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2', decisions: [{ id: 'q1', label: 'supported', confidence: 2 }] }, 'quiz_quality')).toBe(false)
  })

  test('validates semantic requests and prevents cross-kind decisions', () => {
    const semantic = {
      kind: FREE_RESPONSE_ASSESSMENT_KIND,
      requestId: 'semantic-1',
      inputDigest: 'b'.repeat(64),
      contractVersion: CONTRACT_VERSION,
      snapshotVersion: SNAPSHOT_VERSION,
      items: [{
        id: 'a1', question: 'Describe ATP.', questionType: 'free-response', expectedAnswer: 'Energy carrier', learnerAnswer: 'Carries energy',
        evidenceExcerpt: 'ATP carries chemical energy.', language: 'en-CA', rubricVersion: FREE_RESPONSE_ASSESSMENT_KIND,
        rubric: [
          { label: 'fully_correct', description: 'The response answers the question completely and is supported by the evidence.' },
          { label: 'partially_correct', description: 'The response contains a supported correct idea but is materially incomplete or has a minor error.' },
          { label: 'incorrect', description: 'The response is contradicted by the evidence, unsupported, or misses the requested concept.' },
          { label: 'uncertain', description: 'The evidence or response is insufficient to make a reliable assessment.' },
        ],
      }],
    }
    expect(isEvaluationRequest(semantic)).toBe(true)
    expect(isEvaluationRequest({ ...semantic, items: [{ ...semantic.items[0], rubric: semantic.items[0].rubric.map((entry, index) => index === 0 ? { ...entry, description: 'changed policy' } : entry) }] })).toBe(false)
    const result = { status: 'completed', provider: 'laya', modelRevision: 'f9ab0b228f0fc0f14d873dbc99038f135c2da1b2', decisions: [{ id: 'a1', label: 'partially_correct', confidence: 0.7, probabilities: { fully_correct: 0.1, partially_correct: 0.7, incorrect: 0.1, uncertain: 0.1 } }] }
    expect(isEvaluation(result, FREE_RESPONSE_ASSESSMENT_KIND)).toBe(true)
    expect(manifest.decisionKinds.freeResponse.labels).toContain(result.decisions[0]!.label)
    expect(isEvaluation(result, 'quiz_quality')).toBe(false)
    expect(isEvaluation({ ...result, decisions: [{ ...result.decisions[0], probabilities: { fully_correct: 0.1, partially_correct: 0.2, incorrect: 0.1, uncertain: 0.1 } }] }, FREE_RESPONSE_ASSESSMENT_KIND)).toBe(false)
  })
})
