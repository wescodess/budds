import { describe, expect, expectTypeOf, test } from 'vitest'
import type { Doc } from '../convex/_generated/dataModel'
import {
  LEARN_ARTIFACT_LINEAGE_VERSION, LEARN_ARTIFACT_LINEAGE_LIMITS, learnArtifactLookupResultSchema,
  learnArtifactValidationSchema, learnArtifactRegistrationArgsSchema, learnArtifactRegistrationResultSchema,
  validateLearnArtifactLookup, validateLearnArtifactLookupResult,
} from './learn-v2-artifact-lineage'
import { learnIdSchema } from './learn-v2-responses'

const id = <T extends string>(table: T) => learnIdSchema<T>().parse(`${table}-owned`)
const reference = { artifact: { kind: 'document' as const, id: id('documents') }, key: 'whole', revision: 'immutable.r1', payloadDigest: 'a'.repeat(64) }
const validation = { lineageId: id('learnArtifactLineages'), payloadDigest: reference.payloadDigest, manifestDigest: 'b'.repeat(64),
  decision: 'pass' as const, comparedCatalogRevision: 1, coverage: 'complete' as const, coverageWatermark: 'coverage.v1', corpusDigest: 'c'.repeat(64),
  identityPolicyVersion: 'identity.v1', noveltyPolicyVersion: 'novelty.v1', validatorVersion: 'validator.v1', validatorModel: null, harnessArtifactDigest: 'd'.repeat(64) }
const result = { status: 'bound' as const, version: LEARN_ARTIFACT_LINEAGE_VERSION, lineageId: id('learnArtifactLineages'), reference,
  classification: 'teaching' as const, instructionalRegistered: true, catalogRevision: 2, originLineageIds: [], cases: [],
  validation: { ...validation, validationId: id('learnArtifactValidations') } }

describe('artifact lineage wire validators', () => {
  test('freezes object envelopes, closed returns and storage-compatible identity decisions', () => {
    expect(validateLearnArtifactLookup({ reference })).toEqual({ reference })
    expect(validateLearnArtifactLookupResult(result)).toEqual(result)
    expect(validateLearnArtifactLookupResult({ status: 'unavailable', version: LEARN_ARTIFACT_LINEAGE_VERSION })).toEqual({ status: 'unavailable', version: LEARN_ARTIFACT_LINEAGE_VERSION })
    expect(learnArtifactRegistrationArgsSchema.parse({ reference, validationId: id('learnArtifactValidations'), expectedCatalogRevision: 1 })).toHaveProperty('reference')
    expect(learnArtifactRegistrationResultSchema.parse({ version: LEARN_ARTIFACT_LINEAGE_VERSION, lineageId: id('learnArtifactLineages'), catalogRevision: 2 })).toHaveProperty('catalogRevision', 2)
    expectTypeOf<typeof validation>().toExtend<Pick<Doc<'learnArtifactValidations'>, keyof typeof validation>>()
  })

  test.each([
    reference, { reference, userId: 'caller' }, { reference, origin: 'teaching' },
    { reference: { ...reference, snippet: 'safe' } }, { reference: { ...reference, revision: '' } },
    { reference: { ...reference, payloadDigest: 'caller-hash' } }, { reference: { ...reference, key: 'x'.repeat(201) } },
  ])('rejects incomplete or caller-authoritative envelopes %#', input => {
    expect(() => validateLearnArtifactLookup(input)).toThrow()
  })

  test('rejects malformed validation pins and oversized or extended lookup returns', () => {
    for (const changed of [{ comparedCatalogRevision: -1 }, { comparedCatalogRevision: Infinity }, { manifestDigest: 'hash' }, { noveltyPolicyVersion: '' }, { coverage: 'assumed' }]) {
      expect(learnArtifactValidationSchema.safeParse({ ...validation, ...changed }).success).toBe(false)
    }
    expect(learnArtifactLookupResultSchema.safeParse({ ...result, originLineageIds: Array.from({ length: LEARN_ARTIFACT_LINEAGE_LIMITS.maxNodes + 1 }, () => id('learnArtifactLineages')) }).success).toBe(false)
    expect(() => validateLearnArtifactLookupResult({ ...result, prompt: 'private-key' })).toThrow()
    expect(() => validateLearnArtifactLookupResult({ ...result, reference: { ...reference, key: '💥'.repeat(40_000) } })).toThrow()
  })
})
