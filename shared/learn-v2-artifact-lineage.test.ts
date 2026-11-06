import { describe, expect, expectTypeOf, test } from 'vitest'
import type { Doc } from '../convex/_generated/dataModel'
import {
  LEARN_ARTIFACT_LINEAGE_VERSION, LEARN_ARTIFACT_LINEAGE_LIMITS, learnArtifactLookupResultSchema,
  learnArtifactValidationSchema, learnArtifactRegistrationArgsSchema, learnArtifactRegistrationResultSchema,
  learnArtifactBatchRegistrationArgsSchema, learnArtifactBatchRegistrationResultSchema, learnArtifactOwnerRecordSchema,
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


describe('B1 owner-record and batch wire validators', () => {
  test('accepts record identities and bounded batch receipts without caller authority', () => {
    expect(learnArtifactOwnerRecordSchema.parse({ kind: 'document', id: id('documents') })).toHaveProperty('kind', 'document')
    expect(learnArtifactOwnerRecordSchema.parse({ kind: 'audio_job', id: id('audioOverviewJobs') })).toHaveProperty('kind', 'audio_job')
    const artifact = { reference, validationId: id('learnArtifactValidations') }
    const args = { artifacts: [artifact], expectedCatalogRevision: 1 }
    expect(learnArtifactBatchRegistrationArgsSchema.parse(args)).toEqual(args)
    expect(learnArtifactBatchRegistrationArgsSchema.safeParse({ ...args, artifacts: Array.from({ length: 50 }, () => artifact) }).success).toBe(true)
    const receipt = { version: LEARN_ARTIFACT_LINEAGE_VERSION, lineageIds: [id('learnArtifactLineages')], catalogRevision: 2,
      readUsage: { chargedBytes: 20_000, documentsRead: 20, readRequests: 30, limitBytes: 4 * 1024 * 1024 } }
    expect(learnArtifactBatchRegistrationResultSchema.parse(receipt)).toEqual(receipt)
    for (const input of [{ ...args, userId: 'caller' }, { ...args, artifacts: [] }, { ...args, artifacts: Array.from({ length: 51 }, () => artifact) }, { ...args, expectedCatalogRevision: -1 }]) {
      expect(learnArtifactBatchRegistrationArgsSchema.safeParse(input).success).toBe(false)
    }
    expect(learnArtifactOwnerRecordSchema.safeParse({ kind: 'document', id: id('documents'), userId: 'caller' }).success).toBe(false)
    expect(learnArtifactBatchRegistrationResultSchema.safeParse({ ...receipt, readUsage: { ...receipt.readUsage, chargedBytes: -1 } }).success).toBe(false)
  })
})
