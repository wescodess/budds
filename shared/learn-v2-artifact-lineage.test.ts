import { describe, expect, expectTypeOf, test } from 'vitest'
import type { Doc } from '../convex/_generated/dataModel'
import {
  LEARN_ARTIFACT_LINEAGE_VERSION, LEARN_ARTIFACT_LINEAGE_LIMITS, learnArtifactLookupResultSchema,
  learnArtifactValidationSchema, learnArtifactRegistrationArgsSchema, learnArtifactRegistrationResultSchema,
  learnArtifactBatchRegistrationArgsSchema, learnArtifactBatchRegistrationResultSchema, learnArtifactOwnerRecordSchema,
  learnArtifactPreparationArgsSchema, learnArtifactPreparationResultSchema, LEARN_ARTIFACT_PREPARATION_VERSION,
  validateLearnArtifactLookup, validateLearnArtifactLookupResult, LEARN_ARTIFACT_CASE_LIMITS, learnArtifactReferenceSchema,
  learnArtifactDescendantRepinArgsSchema, learnArtifactDescendantRepinResultSchema,
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

describe('server preparation contract', () => {
  const artifact = { artifact: { kind: 'quiz_question', id: id('quizQuestions') }, key: 'whole', origins: [], sources: [] }
  test('accepts only bounded identities and server-built provenance, with computed references in the receipt', () => {
    expect(learnArtifactPreparationArgsSchema.parse({ artifacts: [artifact] })).toEqual({ artifacts: [artifact] })
    expect(learnArtifactPreparationArgsSchema.safeParse({ artifacts: Array.from({ length: 50 }, () => artifact) }).success).toBe(true)
    expect(learnArtifactPreparationArgsSchema.safeParse({ artifacts: Array.from({ length: 51 }, () => artifact) }).success).toBe(false)
    const receipt = { version: LEARN_ARTIFACT_LINEAGE_VERSION, lineageIds: [id('learnArtifactLineages')], catalogRevision: 1,
      references: [reference], readUsage: { chargedBytes: 100, documentsRead: 1, readRequests: 2, limitBytes: 4 * 1024 * 1024 } }
    expect(learnArtifactPreparationResultSchema.parse(receipt)).toEqual(receipt)
    expect(learnArtifactPreparationResultSchema.safeParse({ ...receipt, decision: 'pass' }).success).toBe(false)
  })
  test.each(['classification', 'caseId', 'validationId', 'decision', 'payloadDigest', 'revision', 'semanticAdapter', 'expectedCatalogRevision'])('rejects %s at both envelope levels', field => {
    expect(learnArtifactPreparationArgsSchema.safeParse({ artifacts: [artifact], [field]: 'asserted' }).success).toBe(false)
    expect(learnArtifactPreparationArgsSchema.safeParse({ artifacts: [{ ...artifact, [field]: 'asserted' }] }).success).toBe(false)
  })
  test('keeps preparation evidence private, versioned and compatible with old decisions', () => {
    const preparation = { version: LEARN_ARTIFACT_PREPARATION_VERSION, kind: 'instructional_reservation' as const, instrumentationEpoch: 'epoch.v1',
      historyCompleteness: 'prospective_complete' as const, historyBasisVersion: 'history.v1', reservedCaseCount: 0, deterministicDecision: 'pass' as const,
      semanticDecision: 'not_required' as const, semanticVersion: 'semantic.unavailable.v1' }
    const decision = { ...validation, preparation }
    expect(learnArtifactValidationSchema.parse(decision)).toEqual(decision)
    expect(learnArtifactValidationSchema.parse(validation)).toEqual(validation)
    expectTypeOf<typeof decision>().toExtend<Pick<Doc<'learnArtifactValidations'>, keyof typeof decision>>()
    expect(learnArtifactValidationSchema.safeParse({ ...decision, preparation: { ...preparation, reservedCaseCount: -1 } }).success).toBe(false)
    expect(learnArtifactValidationSchema.safeParse({ ...decision, preparation: { ...preparation, kind: 'personal_work' } }).success).toBe(false)
  })
})


describe('B2 per-kind case caps and descendant re-pin envelopes', () => {
  test('every artifact kind has a case cap sized to its largest projected content', () => {
    expect(Object.keys(LEARN_ARTIFACT_CASE_LIMITS).sort()).toEqual(learnArtifactReferenceSchema.shape.artifact.options.map(option => option.shape.kind.value).sort())
    expect(LEARN_ARTIFACT_CASE_LIMITS).toMatchObject({ flashcard_version: 200 + 1, section_block: 200 + 200 + 1 })
    for (const [kind, cap] of Object.entries(LEARN_ARTIFACT_CASE_LIMITS)) if (kind !== 'flashcard_version' && kind !== 'section_block') expect(cap).toBe(LEARN_ARTIFACT_LINEAGE_LIMITS.maxCases)
  })

  test('a lookup carries graph-wide case links up to its bound within its byte ceiling', () => {
    const pin = { caseId: id('learnAssessmentCases'), scenarioFingerprint: 'e'.repeat(64), solutionFingerprint: 'f'.repeat(64), identityPolicyVersion: 'learn-v2.instructional-case.v1', usageClass: 'instructional' as const }
    const full = { ...result, cases: Array.from({ length: LEARN_ARTIFACT_LINEAGE_LIMITS.maxGraphCases }, () => pin) }
    expect(validateLearnArtifactLookupResult(full).status).toBe('bound')
    expect(learnArtifactLookupResultSchema.safeParse({ ...full, cases: [...full.cases, pin] }).success).toBe(false)
  })

  test('re-pin arguments accept only bounded preparation-kind identities', () => {
    const question = { kind: 'quiz_question' as const, id: id('quizQuestions') }
    expect(learnArtifactDescendantRepinArgsSchema.parse({ artifacts: [question] })).toEqual({ artifacts: [question] })
    for (const input of [{ artifacts: [] }, { artifacts: Array.from({ length: 51 }, () => question) }, { artifacts: [question], origins: [] },
      { artifacts: [{ kind: 'measurement_item', id: id('learnMeasurementItems') }] }, { artifacts: [{ ...question, revision: '1' }] }]) {
      expect(learnArtifactDescendantRepinArgsSchema.safeParse(input).success).toBe(false)
    }
    const receipt = { version: LEARN_ARTIFACT_LINEAGE_VERSION, lineageIds: [], references: [], catalogRevision: 3,
      readUsage: { chargedBytes: 0, documentsRead: 0, readRequests: 0, limitBytes: 4 * 1024 * 1024 } }
    expect(learnArtifactDescendantRepinResultSchema.parse(receipt)).toEqual(receipt)
    expect(learnArtifactDescendantRepinResultSchema.safeParse({ ...receipt, decision: 'pass' }).success).toBe(false)
  })
})
