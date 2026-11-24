/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, expectTypeOf, test, vi } from 'vitest'
import type { Infer, ObjectType } from 'convex/values'
import type { z } from 'zod'
import { api, internal } from './_generated/api'
import schema from './schema'
import { seedCompleteMeasurementStorage as seedMeasurementStorage } from '../tests/fixtures/learn-v2-measurement-storage'
import { POST_SEAL_CANARIES } from '../tests/fixtures/learn-v2-post-seal-storage'
import { authorizeExport } from '../tests/fixtures/learn-v2-personal-export'
import { LEARN_MEASUREMENT_STORAGE_MANIFEST } from '../shared/learn-v2-measurement-storage-manifest'
import {
  fingerprintLearnPracticeHelpRequest, learnPostSealTeachingSourceStorageSchema, learnPostSealPracticeBindingStorageSchema,
  learnPostSealHelpReceiptStorageSchema, learnPostSealSourceLinkStorageSchema, learnPracticeSlotAssistanceStorageSchema,
} from '../shared/learn-v2-post-seal-storage'
import { LEARN_V2_POST_SEAL_TEACHING_VERSION } from '../shared/learn-v2-assessment-disclosure'
import { learnResponseSlotPinsSchema, learnSerializedBytes } from '../shared/learn-v2-responses'
import { readPostSealSourceLinks, purgePostSealSourceLink } from './lib/learnV2PostSealRetention'
import { privacyDigest } from './lib/learnV2ResponsePrivacy'
import type { postSealTeachingSourceValidator, postSealPracticeBindingFields, postSealHelpReceiptFields,
  postSealSourceLinkFields, practiceSlotAssistanceValidator } from './lib/learnV2PostSealStorageContract'

const modules = import.meta.glob('./**/*.ts')
const owner = { tokenIdentifier: 'https://auth.example|post-seal-storage' }
const foreign = { tokenIdentifier: 'https://foreign.example|post-seal-storage' }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

async function fixture() {
  const t = convexTest(schema, modules)
  const f = await t.run(ctx => seedMeasurementStorage(ctx, owner.tokenIdentifier))
  return { t, f }
}

function fields<T extends { _id: unknown, _creationTime: number }>(row: T) {
  const { _id: _id, _creationTime: _time, ...value } = row
  return value
}

async function publishedTeachingFixture(t: ReturnType<typeof convexTest>, f: Awaited<ReturnType<typeof seedMeasurementStorage>>) {
  return await t.run(async ctx => {
    const receipt = (await ctx.db.get(f.postSeal.helpReceiptId))!
    if (receipt.content.status !== 'available') throw new Error('Missing fixture publication')
    const source = fields((await ctx.db.get(f.postSeal.teachingSourceId))!)
    const attemptId = await ctx.db.insert('masteryAttempts', { userId: owner.tokenIdentifier, objectiveId: f.scope.objectiveId,
      attemptedAt: f.base.createdAt, idempotencyKey: 'published-teaching-fixture', serverScorePercent: 50,
      submissionId: f.rows.learnResponses, assessmentOpportunityId: f.rows.learnAssessmentOpportunities })
    const payload = {
      feedback: { tier: 'T0', text: POST_SEAL_CANARIES.feedback, citations: [{ sourceRef: 'public-reference', label: 'Source' }] },
      lesson: { tier: 'T1', paragraphs: [POST_SEAL_CANARIES.lesson], citations: [{ sourceRef: 'public-reference', label: 'Source' }] },
    }
    const dependencies = [
      { kind: 'snapshot' as const, sourceSnapshotId: f.sourceSnapshotId, revision: 1, recordRevision: 1, contentHash: 'a'.repeat(64) },
      { kind: 'document' as const, documentId: f.documentId, sourceRevision: 'source.r1' },
    ]
    const row = learnPostSealTeachingSourceStorageSchema.parse({ ...source, attemptId, sourceDependencyCount: dependencies.length,
      content: { status: 'available', payload, publication: { ...receipt.content.publication,
        payloadDigest: await privacyDigest(payload), sourceManifestDigest: await privacyDigest(dependencies) } } })
    const sourceLinkIds = []
    for (const dependency of dependencies) sourceLinkIds.push(await ctx.db.insert('learnPostSealSourceLinks', learnPostSealSourceLinkStorageSchema.parse({
      ...f.base, learningVoidId: f.learningVoidId, postSealStorageVersion: source.postSealStorageVersion,
      evidenceStatus: 'available', target: { teachingSourceId: f.postSeal.teachingSourceId }, dependency,
    })))
    await ctx.db.replace(f.postSeal.teachingSourceId, row)
    await ctx.db.patch(f.rows.learnAssessmentOpportunities, { authoritativeAttemptId: attemptId, phase: 'scored_fail' })
    return { row, sourceLinkIds }
  })
}

describe('inactive post-seal storage contract', () => {
  test('keeps a pending teaching source independent of publication dependencies', async () => {
    const { t, f } = await fixture()
    const source = fields((await t.run(ctx => ctx.db.get(f.postSeal.teachingSourceId)))!)
    expect(source).toMatchObject({ content: { status: 'pending' }, sourceDependencyCount: 0 })
    expect(await t.run(ctx => ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_target_teachingSourceId', q =>
      q.eq('userId', owner.tokenIdentifier).eq('target.teachingSourceId', f.postSeal.teachingSourceId)).take(65))).toEqual([])
    expect(() => learnPostSealTeachingSourceStorageSchema.parse({ ...source, sourceDependencyCount: 1 })).toThrow()
    await expect(t.run(ctx => ctx.db.patch(f.postSeal.teachingSourceId, { sourceDependencyCount: 1 }))).rejects.toThrow()
    const { row } = await publishedTeachingFixture(t, f)
    const links = await t.run(ctx => ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_target_teachingSourceId', q =>
      q.eq('userId', owner.tokenIdentifier).eq('target.teachingSourceId', f.postSeal.teachingSourceId)).take(65))
    expect(row).toMatchObject({ content: { status: 'available' }, sourceDependencyCount: 2 })
    expect(links).toHaveLength(row.sourceDependencyCount)
    expect(links.map(link => link.dependency?.kind).sort()).toEqual(['document', 'snapshot'])
  })

  test('permits an attempt stamp on a purged pending source without restoring content', async () => {
    const { t, f } = await fixture()
    const content = { status: 'purged' as const, reasonCode: 'evidence_unavailable' as const, purgedAt: f.base.createdAt }
    await t.run(ctx => ctx.db.patch(f.postSeal.teachingSourceId, { evidenceStatus: 'evidence_unavailable', invalidatedAt: f.base.createdAt, content }))
    const before = (await t.run(ctx => ctx.db.get(f.postSeal.teachingSourceId)))!
    expect(learnPostSealTeachingSourceStorageSchema.parse(fields(before))).toMatchObject({ attemptId: null, sourceDependencyCount: 0, content })
    const attemptId = await t.run(async ctx => {
      const id = await ctx.db.insert('masteryAttempts', { userId: owner.tokenIdentifier,
        objectiveId: f.scope.objectiveId, attemptedAt: f.base.createdAt, idempotencyKey: 'purged-source-score-fixture', serverScorePercent: 50,
        submissionId: f.rows.learnResponses, assessmentOpportunityId: f.rows.learnAssessmentOpportunities })
      await ctx.db.patch(f.rows.learnAssessmentOpportunities, { authoritativeAttemptId: id, phase: 'scored_fail' })
      await ctx.db.patch(f.postSeal.teachingSourceId, { attemptId: id })
      return id
    })
    const after = (await t.run(ctx => ctx.db.get(f.postSeal.teachingSourceId)))!
    expect(learnPostSealTeachingSourceStorageSchema.parse(fields(after))).toEqual({ ...fields(before), attemptId })
    expect(await t.run(ctx => ctx.db.get(f.rows.learnAssessmentOpportunities))).toMatchObject({ authoritativeAttemptId: attemptId, phase: 'scored_fail' })
    expect(await t.run(ctx => ctx.db.query('learnPostSealSourceLinks').withIndex('by_userId_and_target_teachingSourceId', q =>
      q.eq('userId', owner.tokenIdentifier).eq('target.teachingSourceId', f.postSeal.teachingSourceId)).take(65))).toEqual([])
  })

  test('keeps the practice prompt delivery distinct from help authorization', async () => {
    const { t, f } = await fixture()
    const slot = (await t.run(ctx => ctx.db.get(f.postSeal.responseSlotId)))!
    const delivery = (await t.run(ctx => ctx.db.get(slot.deliveryExposureId)))!
    expect(delivery._id).not.toBe(f.postSeal.authorizationId)
    expect(delivery).toMatchObject({ userId: slot.userId, learningVoidId: f.learningVoidId,
      blueprintRevisionId: f.scope.blueprintRevisionId, objectiveId: f.scope.objectiveId,
      projectionDigest: slot.promptDigest, purpose: 'practice', status: 'granted' })
    expect(delivery).not.toHaveProperty('assessmentOpportunityId')
    expect(delivery).not.toHaveProperty('practiceHelp')
  })

  test.each(['retrieval', 'prediction', 'teach_back', 'diagnostic'] as const)('rejects practice assistance on a %s slot', async stage => {
    const { t, f } = await fixture()
    const practice = (await t.run(ctx => ctx.db.get(f.postSeal.responseSlotId)))!
    if (practice.stage !== 'practice') throw new Error('Missing practice slot')
    const assistance = learnPracticeSlotAssistanceStorageSchema.parse(practice.practiceAssistance)
    const pins = { stage, slotKey: practice.slotKey, blockId: practice.blockId, promptDigest: practice.promptDigest,
      promptRevision: practice.promptRevision, responseFormatVersion: practice.responseFormatVersion,
      deliveryExposureId: practice.deliveryExposureId, revision: practice.revision }
    expect(learnResponseSlotPinsSchema.parse(pins)).toMatchObject(pins)
    expect(() => learnResponseSlotPinsSchema.parse({ ...pins, practiceAssistance: assistance })).toThrow()
    const { practiceAssistance: _assistance, ...slot } = fields(practice)
    const id = await t.run(ctx => ctx.db.insert('learnResponseSlots', { ...slot, stage }))
    await expect(t.run(ctx => ctx.db.patch(id, { practiceAssistance: assistance }))).rejects.toThrow()
    if (stage === 'diagnostic') {
      const standaloneId = await t.run(ctx => ctx.db.insert('learnResponseSlots', { ...f.base, ...pins, stage: 'diagnostic',
        scopeKind: 'standalone', threadId: f.threadId, activityId: f.activityId, threadRevision: 1, activityRevision: 1,
        activityContractVersion: 'diagnostic.v1', evidenceStatus: 'available', status: 'open' }))
      await expect(t.run(ctx => ctx.db.patch(standaloneId, { practiceAssistance: assistance }))).rejects.toThrow()
    }
    expect(learnResponseSlotPinsSchema.parse({ ...pins, stage: 'practice', practiceAssistance: assistance })).toMatchObject({ practiceAssistance: assistance })
    await expect(t.run(ctx => ctx.db.patch(f.rows.learnAssessmentOpportunities, { practiceAssistance: assistance } as never))).rejects.toThrow()
  })

  test.each(['teachingSourceId', 'practiceBindingId', 'helpReceiptId'] as const)('purges an owned %s through a link with a different Void', async kind => {
    const { t, f } = await fixture()
    if (kind === 'teachingSourceId') await publishedTeachingFixture(t, f)
    const target = kind === 'teachingSourceId' ? { teachingSourceId: f.postSeal.teachingSourceId }
      : kind === 'practiceBindingId' ? { practiceBindingId: f.postSeal.practiceBindingId } : { helpReceiptId: f.postSeal.helpReceiptId }
    const targetId = kind === 'teachingSourceId' ? f.postSeal.teachingSourceId
      : kind === 'practiceBindingId' ? f.postSeal.practiceBindingId : f.postSeal.helpReceiptId
    const id = await t.run(async ctx => {
      const voidFields = fields((await ctx.db.get(f.learningVoidId))!)
      const anotherVoidId = await ctx.db.insert('learningVoids', voidFields)
      const reference = fields((await ctx.db.get(f.postSeal.sourceLinkIds[0]!))!)
      return await ctx.db.insert('learnPostSealSourceLinks', { ...reference, learningVoidId: anotherVoidId, target })
    })
    await t.run(ctx => purgePostSealSourceLink(ctx, owner.tokenIdentifier, id))
    const purged = await t.run(ctx => ctx.db.get(targetId))
    expect(purged).toMatchObject({ evidenceStatus: 'evidence_unavailable', content: { status: 'purged' } })
    for (const canary of Object.values(POST_SEAL_CANARIES)) expect(JSON.stringify(purged)).not.toContain(canary)
    expect(await t.run(ctx => ctx.db.get(id))).not.toHaveProperty('dependency')
    if (kind === 'practiceBindingId') expect(await t.run(ctx => ctx.db.get(f.postSeal.responseSlotId))).toMatchObject({ evidenceStatus: 'evidence_unavailable' })
  })

  test('leaves a foreign target unchanged when redacting an invalid source link', async () => {
    const { t, f } = await fixture()
    const other = await t.run(ctx => seedMeasurementStorage(ctx, foreign.tokenIdentifier))
    const before = await t.run(ctx => ctx.db.get(other.postSeal.helpReceiptId))
    const id = await t.run(async ctx => {
      const reference = fields((await ctx.db.get(f.postSeal.sourceLinkIds[0]!))!)
      return await ctx.db.insert('learnPostSealSourceLinks', { ...reference, target: { helpReceiptId: other.postSeal.helpReceiptId } })
    })
    await t.run(ctx => purgePostSealSourceLink(ctx, owner.tokenIdentifier, id))
    expect(await t.run(ctx => ctx.db.get(other.postSeal.helpReceiptId))).toEqual(before)
    expect(await t.run(ctx => ctx.db.get(id))).not.toHaveProperty('dependency')
  })

  test('preserves string storage labels across every collection using the shared measurement base', async () => {
    const { t, f } = await fixture()
    const collections = LEARN_MEASUREMENT_STORAGE_MANIFEST.filter(entry => !entry.table.startsWith('learnPostSeal')
      && !entry.table.startsWith('learnArtifact') && entry.table !== 'learnMeasurementDueWork')
    expect(collections).toHaveLength(24)
    for (const entry of collections) {
      for (const storageVersion of ['learn-v2.measurement-storage.v1', 'learn-v2.measurement-storage.v99']) {
        await t.run(ctx => ctx.db.patch(f.rows[entry.table], { storageVersion }))
        expect(await t.run(ctx => ctx.db.get(f.rows[entry.table]))).toMatchObject({ storageVersion })
      }
    }
  })

  test('keeps shared storage types aligned with the closed Convex shapes', () => {
    expectTypeOf<z.infer<typeof learnPostSealTeachingSourceStorageSchema>>().toEqualTypeOf<Infer<typeof postSealTeachingSourceValidator>>()
    expectTypeOf<z.infer<typeof learnPostSealPracticeBindingStorageSchema>>().toEqualTypeOf<ObjectType<typeof postSealPracticeBindingFields>>()
    expectTypeOf<z.infer<typeof learnPostSealHelpReceiptStorageSchema>>().toEqualTypeOf<ObjectType<typeof postSealHelpReceiptFields>>()
    expectTypeOf<z.infer<typeof learnPostSealSourceLinkStorageSchema>>().toEqualTypeOf<ObjectType<typeof postSealSourceLinkFields>>()
    expectTypeOf<z.infer<typeof learnPracticeSlotAssistanceStorageSchema>>().toEqualTypeOf<Infer<typeof practiceSlotAssistanceValidator>>()
  })
  test('fingerprints the complete declared request with a fixed encoding and no raw key storage', async () => {
    const request = { version: LEARN_V2_POST_SEAL_TEACHING_VERSION, assessmentOpportunityId: 'check1',
      target: { responseSlotId: 'slot1' }, expectedRevision: 2, kind: 'hint', idempotencyKey: 'practice_help_key_123' }
    const saved = await fingerprintLearnPracticeHelpRequest(request)
    const canonical = '["learn-v2.practice-help-fingerprint.v1","request","learn-v2.post-seal-teaching.v1","check1","slot1",2,"hint","practice_help_key_123"]'
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
    expect(saved.requestDigest).toBe(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''))
    expect(await fingerprintLearnPracticeHelpRequest({ idempotencyKey: request.idempotencyKey, kind: request.kind,
      target: request.target, expectedRevision: 2, version: request.version, assessmentOpportunityId: request.assessmentOpportunityId })).toEqual(saved)
    for (const change of [{ assessmentOpportunityId: 'check2' }, { target: { responseSlotId: 'slot2' } },
      { expectedRevision: 3 }, { kind: 'worked_example' }, { idempotencyKey: 'practice_help_key_456' }]) {
      expect((await fingerprintLearnPracticeHelpRequest({ ...request, ...change })).requestDigest).not.toBe(saved.requestDigest)
    }
    expect(saved.idempotencyKeyHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(saved)).not.toContain(request.idempotencyKey)
    await expect(fingerprintLearnPracticeHelpRequest({ ...request, text: 'undeclared content' })).rejects.toThrow()
  })

  test('keeps every new stored version label readable without enabling historical commands', async () => {
    const { t, f } = await fixture()
    for (const entry of LEARN_MEASUREMENT_STORAGE_MANIFEST) {
      if (!entry.table.startsWith('learnPostSeal')) continue
      for (const version of ['learn-v2.post-seal-storage.v0', 'learn-v2.post-seal-storage.v1', 'learn-v2.post-seal-storage.v99']) {
        await t.run(ctx => ctx.db.patch(f.rows[entry.table], { postSealStorageVersion: version, storageVersion: version }))
        expect(await t.run(ctx => ctx.db.get(f.rows[entry.table]))).toMatchObject({ postSealStorageVersion: version, storageVersion: version })
      }
    }
    for (const version of ['learn-v2.post-seal-teaching.v0', LEARN_V2_POST_SEAL_TEACHING_VERSION, 'learn-v2.post-seal-teaching.v99']) {
      await t.run(ctx => ctx.db.patch(f.postSeal.helpReceiptId, { commandVersion: version, fingerprintVersion: version }))
      const receipt = (await t.run(ctx => ctx.db.get(f.postSeal.helpReceiptId)))!
      expect(learnPostSealHelpReceiptStorageSchema.parse(fields(receipt))).toMatchObject({ commandVersion: version, fingerprintVersion: version })
    }
    for (const version of ['learn-v2.measurement-storage.v1', 'learn-v2.measurement-storage.v99']) {
      await t.run(ctx => ctx.db.patch(f.postSeal.authorizationId, { storageVersion: version }))
      expect(await t.run(ctx => ctx.db.get(f.postSeal.authorizationId))).toMatchObject({ storageVersion: version })
    }
  })

  test('requires an authoritative attempt stamp before content and rejects foreign storage fields', async () => {
    const { t, f } = await fixture()
    const source = fields((await t.run(ctx => ctx.db.get(f.postSeal.teachingSourceId)))!)
    const receipt = (await t.run(ctx => ctx.db.get(f.postSeal.helpReceiptId)))!
    if (receipt.content.status !== 'available') throw new Error('Missing fixture content')
    const payload = { feedback: { tier: 'T0', text: POST_SEAL_CANARIES.feedback, citations: [{ sourceRef: 'public-ref', label: 'Source' }] },
      lesson: { tier: 'T1', paragraphs: [POST_SEAL_CANARIES.lesson], citations: [{ sourceRef: 'public-ref', label: 'Source' }] } }
    const content = { status: 'available' as const, payload, publication: receipt.content.publication }
    const available = { ...source, sourceDependencyCount: 1, content }
    expect(() => learnPostSealTeachingSourceStorageSchema.parse(available)).toThrow()
    await expect(t.run(ctx => ctx.db.replace(f.postSeal.teachingSourceId, available as never))).rejects.toThrow()
    const attemptId = await t.run(ctx => ctx.db.insert('masteryAttempts', { userId: owner.tokenIdentifier, objectiveId: f.scope.objectiveId,
      attemptedAt: f.base.createdAt, idempotencyKey: 'storage-score-fixture', serverScorePercent: 50 }))
    expect(learnPostSealTeachingSourceStorageSchema.parse({ ...available, attemptId })).toMatchObject({ attemptId, content })
    const binding = fields((await t.run(ctx => ctx.db.get(f.postSeal.practiceBindingId)))!)
    const link = fields((await t.run(ctx => ctx.db.get(f.rows.learnPostSealSourceLinks)))!)
    for (const [schema, row] of [[learnPostSealTeachingSourceStorageSchema, source], [learnPostSealPracticeBindingStorageSchema, binding],
      [learnPostSealHelpReceiptStorageSchema, fields(receipt)], [learnPostSealSourceLinkStorageSchema, link]] as const) {
      expect(() => schema.parse(row)).not.toThrow()
      expect(() => schema.parse({ ...row, privateRubric: 'not admitted' })).toThrow()
    }
    expect(() => learnPostSealTeachingSourceStorageSchema.parse({ ...available, attemptId, content: {
      ...content, payload: { ...payload, feedback: { ...payload.feedback, tier: 'T2' } },
    } })).toThrow()
  })

  test('enforces text, collection, UTF-8 payload and complete-envelope ceilings', async () => {
    const { t, f } = await fixture()
    const receipt = fields((await t.run(ctx => ctx.db.get(f.postSeal.helpReceiptId)))!)
    if (receipt.content.status !== 'available') throw new Error('Missing help content')
    const content = receipt.content
    const overhead = learnSerializedBytes({ kind: 'hint', tier: 'T0', text: '' })
    const controls = Math.floor((48 * 1024 - overhead) / 6)
    const remainder = 48 * 1024 - overhead - controls * 6
    const text = '\u0000'.repeat(controls) + 'x'.repeat(remainder)
    const atLimit = { ...content, payload: { kind: 'hint', tier: 'T0', text } }
    expect(learnPostSealHelpReceiptStorageSchema.parse({ ...receipt, content: atLimit })).toBeDefined()
    for (const text of [atLimit.payload.text + 'x', 'x'.repeat(12001), ' ']) {
      expect(() => learnPostSealHelpReceiptStorageSchema.parse({ ...receipt, content: { ...content, payload: { kind: 'hint', tier: 'T0', text } } })).toThrow()
    }
    for (const change of [{ expectedRevision: NaN }, { assistanceSequence: Infinity }, { sourceDependencyCount: 65 },
      { kind: 'worked_example' }, { expiresAt: 1 }, { idempotencyKey: f.postSeal.request.idempotencyKey }, { requestDigest: '{}' }]) {
      expect(() => learnPostSealHelpReceiptStorageSchema.parse({ ...receipt, ...change })).toThrow()
    }
    const source = fields((await t.run(ctx => ctx.db.get(f.postSeal.teachingSourceId)))!)
    expect(() => learnPostSealTeachingSourceStorageSchema.parse({ ...source, userId: 'x'.repeat(65536) })).toThrow()
    const binding = fields((await t.run(ctx => ctx.db.get(f.postSeal.practiceBindingId)))!)
    expect(() => learnPostSealPracticeBindingStorageSchema.parse({ ...binding, practiceCaseId: binding.checkCaseId })).toThrow()
    expect(() => learnPostSealPracticeBindingStorageSchema.parse({ ...binding, caseRelation: 'sibling_form' })).toThrow()
    expect(() => learnPostSealPracticeBindingStorageSchema.parse({ ...binding, reservedCase: 'unknown' })).toThrow()
    const { row: teaching } = await publishedTeachingFixture(t, f)
    if (teaching.content.status !== 'available' || !teaching.content.payload.lesson) throw new Error('Missing lesson')
    const teachingContent = teaching.content
    const lesson = teachingContent.payload.lesson!
    for (const change of [{ paragraphs: Array(9).fill('Paragraph') }, { citations: Array(17).fill(lesson.citations[0]) },
      { paragraphs: Array(8).fill('x'.repeat(12000)) }]) {
      expect(() => learnPostSealTeachingSourceStorageSchema.parse({ ...teaching, content: { ...teachingContent,
        payload: { ...teachingContent.payload, lesson: { ...lesson, ...change } } } })).toThrow()
    }
  })

  test('persists assistance separately and structurally forbids check-targeted practice help', async () => {
    const { t, f } = await fixture()
    const slot = (await t.run(ctx => ctx.db.get(f.postSeal.responseSlotId)))!
    if (slot.stage !== 'practice') throw new Error('Missing practice slot')
    expect(slot.revision).toBe(f.postSeal.request.expectedRevision)
    expect(learnPracticeSlotAssistanceStorageSchema.parse(slot.practiceAssistance)).toMatchObject({ deliveryCount: 1, revision: 1 })
    expect(() => learnPracticeSlotAssistanceStorageSchema.parse({ ...slot.practiceAssistance, deliveryCount: 2 })).toThrow()
    const exposure = (await t.run(ctx => ctx.db.get(f.postSeal.authorizationId)))!
    expect(exposure).not.toHaveProperty('assessmentOpportunityId')
    await expect(t.run(ctx => ctx.db.patch(exposure._id, { assessmentOpportunityId: f.rows.learnAssessmentOpportunities }))).rejects.toThrow()
    const check = (await t.run(ctx => ctx.db.get(f.rows.learnResponses)))!
    expect(check.assistanceSnapshot).toEqual(f.assistanceSnapshot)
    expect((await t.run(ctx => ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_assessmentOpportunityId', q =>
      q.eq('userId', owner.tokenIdentifier).eq('assessmentOpportunityId', f.rows.learnAssessmentOpportunities)).take(8))).map(row => row._id)).not.toContain(exposure._id)
  })

  test.each(['snapshot', 'excerpt', 'document', 'folder'] as const)('purges every content copy by its %s dependency and preserves another owner', async kind => {
    vi.useFakeTimers()
    const { t, f } = await fixture()
    const other = await t.run(ctx => seedMeasurementStorage(ctx, foreign.tokenIdentifier))
    const { row: teaching, sourceLinkIds: teachingSourceLinkIds } = await publishedTeachingFixture(t, f)
    const sourceLinkIds = [...f.postSeal.sourceLinkIds, ...teachingSourceLinkIds]
    const duplicateSourceLinkIds = kind === 'snapshot' ? await t.run(async ctx => {
      const link = fields((await ctx.db.get(f.postSeal.sourceLinkIds[1]!))!)
      const ids = []
      for (let index = 0; index < 7; index++) ids.push(await ctx.db.insert('learnPostSealSourceLinks', link))
      return ids
    }) : []
    const source = kind === 'snapshot' ? { kind, id: f.sourceSnapshotId } : kind === 'excerpt' ? { kind, id: f.sourceExcerptId }
      : kind === 'document' ? { kind, id: f.documentId } : { kind, id: f.folderId }
    const dependency = kind === 'snapshot' ? { kind, sourceSnapshotId: f.sourceSnapshotId, revision: 1, recordRevision: 1, contentHash: 'a'.repeat(64) }
      : kind === 'excerpt' ? { kind, sourceSnapshotId: f.sourceSnapshotId, sourceExcerptId: f.sourceExcerptId, revision: 1, recordRevision: 1, contentHash: 'a'.repeat(64) }
        : kind === 'document' ? { kind, documentId: f.documentId, sourceRevision: 'source.r1' } : { kind, folderId: f.folderId }
    await t.run(async ctx => {
      for (const id of sourceLinkIds) await ctx.db.patch(id, { dependency })
    })
    expect(await t.run(ctx => readPostSealSourceLinks(ctx, owner.tokenIdentifier, source))).toHaveLength(kind === 'snapshot' ? 8 : sourceLinkIds.length)
    expect(await t.run(ctx => readPostSealSourceLinks(ctx, foreign.tokenIdentifier, source))).toEqual([])
    for (let batch = 0; batch < 30; batch++) {
      const pending = kind === 'snapshot' ? (await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: owner.tokenIdentifier, sourceIdentityId: f.sourceIdentityId })).pending
        : kind === 'excerpt' ? (await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: owner.tokenIdentifier, sourceIdentityId: f.sourceIdentityId })).pending
          : kind === 'document' ? (await t.mutation(internal.learnV2Retention.purgeFolderDocumentSources, { userId: owner.tokenIdentifier, documentId: f.documentId })).pending
            : (await t.mutation(internal.learnV2Retention.purgeFolderManifestFolder, { userId: owner.tokenIdentifier, folderId: f.folderId })).pending
      if (!pending) break
      if (batch === 29) throw new Error('Source cleanup did not finish')
    }
    for (const id of [f.postSeal.teachingSourceId, f.postSeal.practiceBindingId, f.postSeal.helpReceiptId]) {
      const row = await t.run(ctx => ctx.db.get(id))
      expect(row).toMatchObject({ evidenceStatus: 'evidence_unavailable', content: { status: 'purged', reasonCode: 'evidence_unavailable' } })
      for (const canary of Object.values(POST_SEAL_CANARIES)) expect(JSON.stringify(row)).not.toContain(canary)
    }
    for (const id of [...sourceLinkIds, ...duplicateSourceLinkIds]) expect(await t.run(ctx => ctx.db.get(id))).not.toHaveProperty('dependency')
    expect(await t.run(ctx => readPostSealSourceLinks(ctx, owner.tokenIdentifier, source))).toEqual([])
    expect(await t.run(ctx => ctx.db.get(f.postSeal.responseSlotId))).toMatchObject({ revision: 1, practiceAssistance: { deliveryCount: 1 } })
    expect(await t.run(ctx => ctx.db.get(f.postSeal.teachingSourceId))).toMatchObject({ attemptId: teaching.attemptId })
    expect(await t.run(ctx => ctx.db.get(other.postSeal.helpReceiptId))).toMatchObject({ content: { status: 'available' } })
    await t.finishInProgressScheduledFunctions()
    vi.clearAllTimers()
  })

  test('exports only classified metadata, without help content, private lineage or raw request fingerprints', async () => {
    const { t, f } = await fixture()
    const authorizationId = await authorizeExport(t.withIdentity(owner))
    for (const entry of LEARN_MEASUREMENT_STORAGE_MANIFEST) {
      if (!entry.table.startsWith('learnPostSeal')) continue
      const result = await t.withIdentity(owner).query(api.dataExport.getUserDataPage, { authorizationId, collection: entry.table, paginationOpts: { cursor: null, numItems: 8 } })
      expect(result.page.length).toBeGreaterThan(0)
      for (const row of result.page) {
        for (const field of ['content', 'dependency', 'caseValidationDigest', 'checkCaseId', 'practiceCaseId', 'idempotencyKeyHash', 'requestDigest']) expect(row).not.toHaveProperty(field)
      }
      for (const canary of Object.values(POST_SEAL_CANARIES)) expect(JSON.stringify(result)).not.toContain(canary)
    }
    expect(await t.run(ctx => ctx.db.query('learnActivityEvents').withIndex('by_userId', q => q.eq('userId', owner.tokenIdentifier)).take(8))).toEqual([])
    expect(await t.run(ctx => ctx.db.get(f.postSeal.helpReceiptId))).not.toHaveProperty('expiresAt')
  })
})
