import { describe, expect, test } from 'vitest'
import {
  ADAPTIVE_V2_PILOT_MANIFEST,
  adaptiveV2PilotDecision,
  isFiniteAdaptiveV2PilotManifest,
  validateAdaptiveProviderPayload,
} from './adaptive-v2-pilot-policy'

describe('Adaptive V2 pilot policy', () => {
  test('fails closed unless the exact finite approved pilot manifest is configured', () => {
    expect(adaptiveV2PilotDecision(undefined)).toEqual({ allowed: false, code: 'pilot_manifest_missing' })
    expect(adaptiveV2PilotDecision('wrong-version')).toEqual({ allowed: false, code: 'pilot_manifest_mismatch' })
    expect(ADAPTIVE_V2_PILOT_MANIFEST.pilotApproved).toBe(false)
    expect(adaptiveV2PilotDecision(ADAPTIVE_V2_PILOT_MANIFEST.version)).toEqual({ allowed: false, code: 'pilot_manifest_not_approved' })
  })

  test('keeps pilot admission separate from general availability', () => {
    expect(ADAPTIVE_V2_PILOT_MANIFEST.scope).toBe('slice_1_pilot')
    expect(ADAPTIVE_V2_PILOT_MANIFEST.gaApproved).toBe(false)
    expect(ADAPTIVE_V2_PILOT_MANIFEST.limits).toMatchObject({
      maxRequestBytes: expect.any(Number),
      maxResponseBytes: expect.any(Number),
      maxOutputTokens: expect.any(Number),
      timeoutMs: expect.any(Number),
      maxAttempts: 1,
      maxProviderDispatchesPerWindow: expect.any(Number),
      costCeilingUsdPerRequest: expect.any(Number),
    })
    expect(Object.values(ADAPTIVE_V2_PILOT_MANIFEST.limits).every(value => Number.isFinite(value) && value > 0)).toBe(true)
  })

  test('admits only an exact approved in-window pinned pilot fixture and never treats it as GA', () => {
    const manifest = {
      ...ADAPTIVE_V2_PILOT_MANIFEST,
      pilotApproved: true,
      cohort: { ...ADAPTIVE_V2_PILOT_MANIFEST.cohort, subjectHashes: [`sha256:${'a'.repeat(64)}`] },
      modelPolicies: [{ model: 'test/mastery-model', inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 4 }],
    }
    const input = {
      model: 'test/mastery-model',
      now: Date.parse('2026-10-01T00:00:00.000Z'),
      activityContractVersion: 'learn-adaptive.activity-contract.v1',
      evaluationContractVersion: 'learn-adaptive.evaluation.v1',
      learnerHash: `sha256:${'a'.repeat(64)}`,
    }
    expect(adaptiveV2PilotDecision(manifest.version, input, manifest)).toEqual({ allowed: true })
    expect(adaptiveV2PilotDecision(manifest.version, input, { ...manifest, gaApproved: true })).toMatchObject({ allowed: false, code: 'pilot_manifest_invalid' })
    expect(adaptiveV2PilotDecision(manifest.version, { ...input, model: 'unapproved/model' }, manifest)).toMatchObject({ allowed: false })
    expect(adaptiveV2PilotDecision(manifest.version, { ...input, learnerHash: `sha256:${'b'.repeat(64)}` }, manifest)).toEqual({ allowed: false, code: 'pilot_cohort_denied' })
  })

  test('denies a 51st hashed learner and rejects a manifest that tries to expand past the finite cohort', () => {
    const subjectHashes = Array.from({ length: 50 }, (_, index) => `sha256:${index.toString(16).padStart(64, '0')}`)
    const manifest = { ...ADAPTIVE_V2_PILOT_MANIFEST, pilotApproved: true, cohort: { ...ADAPTIVE_V2_PILOT_MANIFEST.cohort, subjectHashes }, modelPolicies: [{ model: 'test/mastery-model', inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 4 }] }
    const fiftyFirst = `sha256:${(50).toString(16).padStart(64, '0')}`
    expect(adaptiveV2PilotDecision(manifest.version, {
      model: 'test/mastery-model', now: Date.parse('2026-10-01T00:00:00.000Z'),
      activityContractVersion: 'learn-adaptive.activity-contract.v1', evaluationContractVersion: 'learn-adaptive.evaluation.v1', learnerHash: fiftyFirst,
    }, manifest)).toEqual({ allowed: false, code: 'pilot_cohort_denied' })
    expect(isFiniteAdaptiveV2PilotManifest({ ...manifest, cohort: { ...manifest.cohort, subjectHashes: [...subjectHashes, fiftyFirst] } })).toBe(false)
    expect(JSON.stringify(manifest)).not.toContain('auth.example.com')
  })

  test.each([
    ['non-finite request cap', { limits: { ...ADAPTIVE_V2_PILOT_MANIFEST.limits, maxRequestBytes: Number.POSITIVE_INFINITY } }],
    ['zero daily quota', { limits: { ...ADAPTIVE_V2_PILOT_MANIFEST.limits, maxProviderDispatchesPerDay: 0 } }],
    ['wrong timeout', { limits: { ...ADAPTIVE_V2_PILOT_MANIFEST.limits, timeoutMs: 30_000 } }],
    ['GA conflation', { gaApproved: true }],
    ['invalid window', { endsAt: ADAPTIVE_V2_PILOT_MANIFEST.startsAt }],
    ['unenforceable cost ceiling', { modelPolicies: [{ model: 'expensive', inputUsdPerMillionTokens: 10_000, outputUsdPerMillionTokens: 10_000 }] }],
  ])('rejects malformed finite policy: %s', (_label, override) => {
    const manifest = { ...ADAPTIVE_V2_PILOT_MANIFEST, ...override }
    expect(isFiniteAdaptiveV2PilotManifest(manifest)).toBe(false)
  })

  test.each([
    'Email me at private@example.com',
    'Use https://private.example.com/notes',
    'Open /Users/alice/private-notes.txt',
    'Read private-notes.pdf',
    'Use unpublished notes from the folder',
    'Learner id 123e4567-e89b-12d3-a456-426614174000',
    'token=sk-secret-value',
    'Bearer abcdefghijklmnopqrstuvwxyz',
  ])('rejects protected provider payload content: %s', (learnerResponse) => {
    expect(validateAdaptiveProviderPayload({ learnerResponse, challenge: 'Explain the supported claim.', evidence: ['Published evidence.'] }))
      .toEqual({ allowed: false, code: 'protected_payload_content' })
  })

  test('accepts only bounded necessary text and never returns raw content', () => {
    expect(validateAdaptiveProviderPayload({ learnerResponse: 'The evidence supports the claim.', challenge: 'Explain why.', evidence: ['Published evidence.'] }))
      .toEqual({ allowed: true, requestBytes: 116 })
  })

  test('rejects unexpected raw query or provider-envelope fields', () => {
    expect(validateAdaptiveProviderPayload({ learnerResponse: 'Answer.', challenge: 'Explain.', evidence: ['Evidence.'], rawQuery: 'private' } as never))
      .toEqual({ allowed: false, code: 'protected_payload_content' })
    expect(validateAdaptiveProviderPayload({ learnerResponse: 'Answer.', challenge: 'Explain.', evidence: ['Evidence.'], rawProviderResponse: '{}' } as never))
      .toEqual({ allowed: false, code: 'protected_payload_content' })
  })
})
