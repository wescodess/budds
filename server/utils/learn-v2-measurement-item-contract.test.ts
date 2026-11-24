import { expect, test } from 'vitest'
import { assertMeasurementScoringContract } from './learn-v2-measurement-item-contract'
import { buildBaselineMasteryScoringPayload, buildBaselineMasteryScoringRequest, type BaselineMasteryScoringInput } from './learn-v2-mastery-scorer'
import { serializeCompletionRequest } from './ai-gateway'
import { LEARN_MEASUREMENT_ITEM_LIMITS as limits } from '../../shared/learn-v2-measurement-item-limits'
import type { LearnScorerBinding } from '../../shared/learn-v2-measurement'

const binding: LearnScorerBinding = { kind: 'deterministic', engineVersion: 'fixture.numeric.v1', thresholdVersion: 'threshold.v1',
  thresholdPercent: 80, transitionVersion: 'learn-v2.mastery-transition.v1' }
const input: BaselineMasteryScoringInput = { rubric: { version: 'rubric.v1', criteria: [{ key: 'accuracy', description: 'Apply the rule.', weightPercent: 100 }] },
  challenge: 'Apply the declared rule.', evidence: [{ alias: 'S1', claim: '', excerpt: 'The source rule.' }], learnerResponse: 'x' }
function bytes(value: BaselineMasteryScoringInput) {
  const request = buildBaselineMasteryScoringRequest('measurement-deterministic', buildBaselineMasteryScoringPayload(value), new AbortController().signal)
  request.captureScoringProvenance = true
  return new TextEncoder().encode(serializeCompletionRequest(request)).byteLength
}

test('publication reserves the full response allowance in the exact serialized provider request', () => {
  const staticMaximum = limits.scoringRequestBytes - limits.responseWireBytes
  const at = { ...input, evidence: [{ ...input.evidence[0]!, claim: 'a'.repeat(staticMaximum - bytes(input)) }] }
  expect(bytes(at)).toBe(staticMaximum)
  expect(() => assertMeasurementScoringContract(at, binding)).not.toThrow()
  const above = { ...at, evidence: [{ ...at.evidence[0]!, claim: `${at.evidence[0]!.claim}a` }] }
  expect(bytes(above)).toBe(staticMaximum + 1)
  expect(() => assertMeasurementScoringContract(above, binding)).toThrow('item_scoring_request_limit')
  const full = { ...at, learnerResponse: 'a'.repeat(limits.responseWireBytes + 1) }
  expect(bytes(full)).toBe(limits.scoringRequestBytes)
  expect(() => assertMeasurementScoringContract(full, binding, true)).not.toThrow()
  expect(() => assertMeasurementScoringContract({ ...full, learnerResponse: `${full.learnerResponse}a` }, binding, true)).toThrow('response_payload_limit')
})

test('the response allowance counts escaped wire bytes rather than code units', () => {
  const at = { ...input, learnerResponse: '\\'.repeat(4000) }
  expect(bytes(at) - bytes(input)).toBe(15_999)
  expect(() => assertMeasurementScoringContract(at, binding, true)).not.toThrow()
  const above = { ...input, learnerResponse: '\\'.repeat(4001) }
  expect(bytes(above) - bytes(input)).toBe(16_003)
  expect(() => assertMeasurementScoringContract(above, binding, true)).toThrow('response_payload_limit')
})
