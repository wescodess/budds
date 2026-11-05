/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from './_generated/api'
import schema from './schema'
import { seedMeasurementStorage, STORAGE_CANARIES } from '../tests/fixtures/learn-v2-measurement-storage'
import { LEARN_MEASUREMENT_CAPABILITIES, LEARN_MEASUREMENT_COLLECTIONS, LEARN_MEASUREMENT_STORAGE_MANIFEST, type LearnMeasurementCollection } from '../shared/learn-v2-measurement-storage-manifest'
import { readMeasurementSourceDescendants, readMeasurementVoidDescendants } from './lib/learnV2MeasurementRetention'
import { initiateAdaptiveThreadDeletion } from './learnAdaptiveCommands'
import type { Doc } from './_generated/dataModel'
import { LEARN_V2_CONTRACT } from '../shared/learn-v2-contract'

const modules = import.meta.glob('./**/*.ts')
const owner = { tokenIdentifier: 'https://auth.example.com|measurement-owner', subject: 'same-subject' }
const foreign = { tokenIdentifier: 'https://other-issuer.example.com|measurement-owner', subject: 'same-subject' }
type Page = { page: Array<Record<string, unknown>>, isDone: boolean, continueCursor: string }

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

async function readAll(t: ReturnType<typeof convexTest>, identity: typeof owner, collection: LearnMeasurementCollection) {
  const rows: Array<Record<string, unknown>> = []
  let cursor: string | null = null
  for (let page = 0; page < 20; page++) {
    const result: Page = await t.withIdentity(identity).query(api.dataExport.getUserDataPage, { collection, paginationOpts: { cursor, numItems: 1 } })
    expect(result.page.length).toBeLessThanOrEqual(1)
    rows.push(...result.page)
    if (result.isDone) return rows
    expect(result.continueCursor).not.toBe(cursor)
    expect(result.continueCursor).not.toBe('')
    cursor = result.continueCursor
  }
  throw new Error('Owner export failed to finish within the fixture bound')
}

describe('inactive Phase C storage boundaries', () => {
  test('enumerates every owned collection safely with product flags off and denies another issuer', async () => {
    vi.stubEnv('LEARN_V2_ENABLED', 'false')
    vi.stubEnv('LEARN_ADAPTIVE_EXPERIENCE_ENABLED', 'false')
    const t = convexTest(schema, modules)
    const a = await t.run(ctx => seedMeasurementStorage(ctx, owner.tokenIdentifier))
    const b = await t.run(ctx => seedMeasurementStorage(ctx, foreign.tokenIdentifier))
    expect(Object.keys(a.rows).sort()).toEqual([...LEARN_MEASUREMENT_COLLECTIONS].sort())
    expect(Object.values(LEARN_MEASUREMENT_CAPABILITIES).every(value => value === false)).toBe(true)
    for (const entry of LEARN_MEASUREMENT_STORAGE_MANIFEST) {
      const rows = await readAll(t, owner, entry.table)
      if (entry.export === 'withheld') expect(rows).toEqual([])
      else expect(rows.map(row => row._id)).toContain(a.rows[entry.table])
      expect(JSON.stringify(rows)).not.toContain(b.rows[entry.table])
      for (const [name, canary] of Object.entries(STORAGE_CANARIES)) {
        if (name === 'answer' && entry.export === 'owner_response') expect(JSON.stringify(rows)).toContain(canary)
        else expect(JSON.stringify(rows)).not.toContain(canary)
      }
      const otherRows = await readAll(t, foreign, entry.table)
      expect(JSON.stringify(otherRows)).not.toContain(a.rows[entry.table])
      await expect(t.query(api.dataExport.getUserDataPage, { collection: entry.table, paginationOpts: { cursor: null, numItems: 8 } })).rejects.toThrow('Unauthenticated')
    }
    vi.unstubAllEnvs()
  })

  test('bounds direct export pages at eight and keeps rejected receipt history pageable', async () => {
    const t = convexTest(schema, modules)
    const fixture = await t.run(ctx => seedMeasurementStorage(ctx, owner.tokenIdentifier))
    await t.run(async (ctx) => {
      const original = await ctx.db.get(fixture.rows.learnResponseCommandReceipts)
      if (!original) throw new Error('Missing fixture receipt')
      const { _id: _id, _creationTime: _creationTime, ...fields } = original
      for (let index = 0; index < 9; index++) await ctx.db.insert('learnResponseCommandReceipts', { ...fields, idempotencyKeyHash: `rejection-${index}`, result: { kind: 'rejected', reasonCode: 'oversized' }, expiresAt: fixture.base.createdAt + 90 * 86_400_000 })
    })
    const result: Page = await t.withIdentity(owner).query(api.dataExport.getUserDataPage, { collection: 'learnResponseCommandReceipts', paginationOpts: { cursor: null, numItems: 10_000 } })
    expect(result.page).toHaveLength(8)
    expect(result.isDone).toBe(false)
    expect(await readAll(t, owner, 'learnResponseCommandReceipts')).toHaveLength(10)
  })

  test('executes every registered index over seeded rows and retains separate first-check sequences', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => seedMeasurementStorage(ctx, owner.tokenIdentifier))
    for (const entry of LEARN_MEASUREMENT_STORAGE_MANIFEST) {
      const contract = LEARN_V2_CONTRACT.persistence.tables.find(table => table.name === entry.table)
      expect(contract?.retentionClass).toBe(entry.retention)
      for (const fields of [['userId'], ...entry.indexes]) {
        const name = `by_${fields.map(field => field.replaceAll('.', '_')).join('_and_')}`
        const rows = await t.run(ctx => ctx.db.query(entry.table).withIndex(name as never).take(8))
        expect(rows.some(row => row._id === f.rows[entry.table]), `${entry.table}.${name}`).toBe(true)
      }
    }
    const legacyBasisId = await t.run(ctx => ctx.db.insert('masteryAttempts', { userId: owner.tokenIdentifier, objectiveId: f.scope.objectiveId, attemptedAt: f.base.createdAt, idempotencyKey: 'basis', kind: 'independent_application', serverScorePercent: 80 }))
    const claim = { claimKey: 'first-independent-claim', claimSequence: 1, basisAttemptId: legacyBasisId, masteryRecordRevision: 4, firstIndependentAt: f.base.createdAt, firstIndependentLocalDate: '2027-01-15', firstIndependentTimezone: 'America/Toronto', transitionVersion: 'learn-v2.mastery-transition.v1' as const, claimFactSequence: 2 }
    await t.run(async (ctx) => {
      await ctx.db.patch(f.rows.learnAssessmentOpportunities, { firstCheckClaim: claim, checkSequence: 1 })
      await ctx.db.insert('learnMeasurementReportFacts', { ...f.base, learningVoidId: f.learningVoidId, sequence: 2, epoch: 'fixture-epoch', factVersion: 'learn-v2.measurement-report-source.v1', occurredAt: f.base.createdAt, fact: { kind: 'independent_claim', ...claim, firstCheckOpportunityId: f.rows.learnAssessmentOpportunities, checkSequence: 1 } })
    })
    expect(await t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_firstCheckClaim_claimKey_and_checkSequence', q => q.eq('userId', owner.tokenIdentifier).eq('firstCheckClaim.claimKey', claim.claimKey).eq('checkSequence', 1)).unique())).toMatchObject({ firstCheckClaim: { claimSequence: 1 }, checkSequence: 1 })
    expect(await t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_fact_claimKey_and_fact_claimSequence', q => q.eq('userId', owner.tokenIdentifier).eq('fact.claimKey', claim.claimKey).eq('fact.claimSequence', 1)).unique())).toMatchObject({ sequence: 2, fact: { claimSequence: 1, checkSequence: 1 } })
  })

  test('preserves independently written correct work without releasing a stored key', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => seedMeasurementStorage(ctx, owner.tokenIdentifier))
    await t.run(ctx => ctx.db.patch(f.rows.learnResponseBodies, { payload: { kind: 'text', text: STORAGE_CANARIES.key } }))
    expect(await readAll(t, owner, 'learnResponseBodies')).toMatchObject([{ payload: { kind: 'text', text: STORAGE_CANARIES.key } }])
    expect(JSON.stringify(await readAll(t, owner, 'learnMeasurementScoringSpecs'))).not.toContain(STORAGE_CANARIES.key)
  })

  test('requires complete pins for a measurement score and preserves absent legacy kind/model semantics', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => seedMeasurementStorage(ctx, owner.tokenIdentifier))
    const legacy = { userId: owner.tokenIdentifier, objectiveId: f.scope.objectiveId, attemptedAt: f.base.createdAt, idempotencyKey: 'legacy', scorerModel: 'historical-content-model', serverScorePercent: 80 }
    const legacyId = await t.run(ctx => ctx.db.insert('masteryAttempts', legacy))
    expect(await t.run(ctx => ctx.db.get(legacyId))).toMatchObject(legacy)
    expect(await t.run(ctx => ctx.db.get(legacyId))).not.toHaveProperty('measurementStorage')
    expect(await t.run(ctx => ctx.db.get(legacyId))).not.toHaveProperty('kind')
    // Deliberately cross the runtime schema boundary with malformed persisted
    // input; command/payload validators belong to the next serial ticket.
    await expect(t.run(ctx => ctx.db.insert('masteryAttempts', { ...legacy, kind: 'measurement_delayed', horizonDays: 7 } as Doc<'masteryAttempts'>))).rejects.toThrow()
    const pins = { version: 'learn-v2.measurement-storage.v1' as const, scope: f.scope, assessmentOpportunityId: f.rows.learnAssessmentOpportunities, submissionId: f.rows.learnResponses, executionId: f.rows.learnScoringExecutions, itemPins: f.itemPins, scoringBinding: f.scoringBinding, assistanceSnapshot: f.assistanceSnapshot, validitySnapshot: f.validitySnapshot, acceptedAt: f.base.createdAt, scoreCommittedAt: f.base.createdAt + 1, requestedScorerModel: 'fixture-model', returnedScorerModel: null }
    const attemptId = await t.run(ctx => ctx.db.insert('masteryAttempts', { ...legacy, blueprintRevisionId: f.scope.blueprintRevisionId, idempotencyKey: 'measurement', kind: 'measurement_delayed', horizonDays: 30, submissionId: f.rows.learnResponses, assessmentOpportunityId: f.rows.learnAssessmentOpportunities, measurementStorage: pins }))
    const result = await t.run(ctx => ctx.db.get(attemptId))
    expect(result).toMatchObject({ kind: 'measurement_delayed', horizonDays: 30, measurementStorage: { acceptedAt: f.base.createdAt, returnedScorerModel: null } })
    const exported: Page = await t.withIdentity(owner).query(api.dataExport.getUserDataPage, { collection: 'masteryAttempts', paginationOpts: { cursor: null, numItems: 8 } })
    expect(JSON.stringify(exported)).not.toContain('measurementStorage')
    expect(JSON.stringify(exported)).not.toContain('fixture-model')
  })

  test('requires frozen protocol pins and keeps ordinary applications on their existing content authority', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => seedMeasurementStorage(ctx, owner.tokenIdentifier))
    const assignment = await t.run(ctx => ctx.db.get(f.rows.learnMeasurementAssignments))
    if (!assignment || assignment.status !== 'admitted' || assignment.allocation.kind !== 'three_case') throw new Error('Expected a three-case fixture')
    expect(new Set([assignment.allocation.cold.caseId, assignment.allocation.day7.caseId, assignment.allocation.day30.caseId]).size).toBe(3)
    const { _id: _id, _creationTime: _creationTime, protocolVersion: _protocolVersion, ...incomplete } = assignment
    await expect(t.run(ctx => ctx.db.insert('learnMeasurementAssignments', incomplete as Doc<'learnMeasurementAssignments'>))).rejects.toThrow()
    const opportunity = await t.run(ctx => ctx.db.get(f.rows.learnAssessmentOpportunities))
    if (!opportunity) throw new Error('Missing fixture opportunity')
    const { _id: _opportunityId, _creationTime: _opportunityCreationTime, ...fields } = opportunity
    const ordinaryCaseId = await t.run(ctx => ctx.db.insert('learnAssessmentCases', { ...f.base, caseKey: 'ordinary-case', scenarioFingerprint: 'ordinary-scenario', solutionFingerprint: 'ordinary-solution', identityPolicyVersion: 'identity.v1', usageClass: 'instructional', identityValidationId: f.rows.learnMeasurementValidations }))
    const ordinaryId = await t.run(ctx => ctx.db.insert('learnAssessmentOpportunities', {
      ...fields, delayedCheckId: 'ordinary-application', purpose: { kind: 'independent_application' },
      assessmentPins: { kind: 'session_application', caseId: ordinaryCaseId, promptDigest: 'ordinary-prompt', rubricVersion: 'rubric.v1', rubricDigest: 'rubric-hash', supportManifestDigest: 'support-hash' },
      assignmentId: undefined, submissionId: undefined, deliveryGrantId: undefined, phase: 'ready',
    }))
    expect(await t.run(ctx => ctx.db.get(ordinaryId))).toMatchObject({ purpose: { kind: 'independent_application' }, assessmentPins: { kind: 'session_application' } })
    expect(await t.run(ctx => ctx.db.get(ordinaryId))).not.toHaveProperty('itemPins')
  })

  test('discovers exact source and Void descendants without returning foreign rows', async () => {
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => seedMeasurementStorage(ctx, owner.tokenIdentifier))
    await t.run(ctx => seedMeasurementStorage(ctx, foreign.tokenIdentifier))
    const sourceRows = await t.run(ctx => readMeasurementSourceDescendants(ctx, owner.tokenIdentifier, { kind: 'snapshot', id: f.sourceSnapshotId }))
    expect(sourceRows).toHaveLength(3)
    expect(sourceRows).toContainEqual({ collection: 'learnMeasurementSupports', id: f.rows.learnMeasurementSupports })
    expect(await t.run(ctx => readMeasurementSourceDescendants(ctx, foreign.tokenIdentifier, { kind: 'snapshot', id: f.sourceSnapshotId }))).toEqual([])
    for (const entry of LEARN_MEASUREMENT_STORAGE_MANIFEST) {
      if (entry.voidDeletion !== 'delete') continue
      const rows = await t.run(ctx => readMeasurementVoidDescendants(ctx, owner.tokenIdentifier, f.learningVoidId, entry.table))
      expect(rows).toContainEqual({ collection: entry.table, id: f.rows[entry.table] })
      expect(await t.run(ctx => readMeasurementVoidDescendants(ctx, foreign.tokenIdentifier, f.learningVoidId, entry.table))).toEqual([])
    }
    expect(await t.run(ctx => ctx.db.query('learnAssessmentOpportunities').withIndex('by_phase_and_dueAt', q => q.eq('phase', 'submitted_sealed').lte('dueAt', f.base.createdAt)).take(8))).toHaveLength(2)
    expect(await t.run(ctx => ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_sequence', q => q.eq('userId', owner.tokenIdentifier).lte('sequence', 1)).take(8))).toHaveLength(1)
  })

  test('revokes body export before cleanup and drains source-linked storage through registered retention', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const a = await t.run(ctx => seedMeasurementStorage(ctx, owner.tokenIdentifier))
    const b = await t.run(ctx => seedMeasurementStorage(ctx, foreign.tokenIdentifier))
    await t.run(ctx => ctx.db.patch(a.sourceSnapshotId, { effectiveStatus: 'unavailable', unavailableReason: 'source_deleted' }))
    expect(await readAll(t, owner, 'learnResponseBodies')).toMatchObject([{ bodyAvailability: 'unavailable' }])
    for (let batch = 0; batch < 20; batch++) {
      const result = await t.mutation(internal.learnV2Retention.purgeSourceEvidence, { userId: owner.tokenIdentifier, sourceIdentityId: a.sourceIdentityId })
      if (!result.pending) break
      if (batch === 19) throw new Error('Source cleanup did not finish')
    }
    expect(await t.run(ctx => ctx.db.get(a.rows.learnResponseBodies))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(a.rows.learnResponses))).toMatchObject({ bodyAvailability: 'purged', currentEligibility: 'excluded', assistanceSnapshot: a.assistanceSnapshot })
    expect(await t.run(ctx => ctx.db.get(a.rows.learnMeasurementItems))).not.toHaveProperty('prompt')
    const retainedItems = await t.run(ctx => ctx.db.query('learnMeasurementItems').withIndex('by_userId', q => q.eq('userId', owner.tokenIdentifier)).take(8))
    expect(retainedItems).toHaveLength(3)
    expect(retainedItems.every(item => item.prompt === undefined && item.evidenceStatus === 'evidence_unavailable')).toBe(true)
    expect(await t.run(ctx => ctx.db.get(a.rows.learnMeasurementScoringSpecs))).not.toHaveProperty('payload')
    expect(await t.run(ctx => ctx.db.get(a.rows.learnMeasurementReportRuns))).toMatchObject({ status: 'stale' })
    expect(await t.run(ctx => ctx.db.get(b.rows.learnResponseBodies))).not.toBeNull()
    await t.finishInProgressScheduledFunctions()
    vi.clearAllTimers()
  })

  test.each(['document', 'folder'] as const)('registers direct %s dependencies without a source snapshot', async (kind) => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => seedMeasurementStorage(ctx, owner.tokenIdentifier))
    await t.run(ctx => ctx.db.patch(f.rows.learnResponseEvidenceLinks, { dependency: kind === 'document'
      ? { kind, documentId: f.documentId, sourceRevision: 'source.r1' }
      : { kind, folderId: f.folderId, scopeRevision: 'folder.r1' } }))
    const source = kind === 'document' ? { kind, id: f.documentId } : { kind, id: f.folderId }
    expect(await t.run(ctx => readMeasurementSourceDescendants(ctx, owner.tokenIdentifier, source))).toEqual([{ collection: 'learnResponseEvidenceLinks', id: f.rows.learnResponseEvidenceLinks }])
    for (let batch = 0; batch < 8; batch++) {
      const result = kind === 'document'
        ? await t.mutation(internal.learnV2Retention.purgeFolderDocumentSources, { userId: owner.tokenIdentifier, documentId: f.documentId })
        : await t.mutation(internal.learnV2Retention.purgeFolderManifestFolder, { userId: owner.tokenIdentifier, folderId: f.folderId })
      if (!result.pending) break
      if (batch === 7) throw new Error('Dependency cleanup did not complete')
    }
    expect(await t.run(ctx => ctx.db.get(f.rows.learnResponseBodies))).toBeNull()
    await t.finishInProgressScheduledFunctions()
    vi.clearAllTimers()
  })

  test('deletes the Void-owned graph while preserving owner case consumption and another owner', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const a = await t.run(ctx => seedMeasurementStorage(ctx, owner.tokenIdentifier))
    const b = await t.run(ctx => seedMeasurementStorage(ctx, foreign.tokenIdentifier))
    for (let batch = 0; batch < 70; batch++) {
      const result = await t.mutation(internal.learnV2Retention.deleteFolderFoundation, { userId: owner.tokenIdentifier, folderId: a.folderId })
      if (!result.hasMore) break
      if (batch === 69) throw new Error('Aggregate deletion did not finish')
    }
    for (const entry of LEARN_MEASUREMENT_STORAGE_MANIFEST) {
      const row = await t.run(ctx => ctx.db.get(a.rows[entry.table]))
      if (entry.voidDeletion === 'delete') expect(row, entry.table).toBeNull()
      else expect(row, entry.table).not.toBeNull()
      expect(await t.run(ctx => ctx.db.get(b.rows[entry.table]))).not.toBeNull()
    }
    expect(await t.run(ctx => ctx.db.get(a.rows.learnAssessmentExposures))).not.toHaveProperty('learningVoidId')
    expect(await t.run(ctx => ctx.db.get(a.rows.learnAssessmentCases))).toMatchObject({ usageClass: 'measurement_reserved' })
    await t.finishInProgressScheduledFunctions()
    vi.clearAllTimers()
  })

  test('deletes standalone response descendants without removing V2 history through a Canvas wrapper', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const f = await t.run(ctx => seedMeasurementStorage(ctx, owner.tokenIdentifier))
    const standalone = await t.run(async (ctx) => {
      // A separate ungraded diagnostic identity; it never has assessment pins.
      const original = await ctx.db.get(f.rows.learnResponseSlots)
      const originalResponse = await ctx.db.get(f.rows.learnResponses)
      if (!original || !originalResponse) throw new Error('Missing fixture response')
      const slotId = await ctx.db.insert('learnResponseSlots', { ...f.base, evidenceStatus: 'available', scopeKind: 'standalone', threadId: f.threadId, activityId: f.activityId, threadRevision: 1, activityRevision: 1, activityContractVersion: 'diagnostic.v1', stage: 'diagnostic', slotKey: 'diagnostic', blockId: 'diagnostic', promptDigest: 'diagnostic-hash', promptRevision: 1, responseFormatVersion: 'text.v1', deliveryExposureId: f.rows.learnAssessmentExposures, revision: 1, status: 'accepted' })
      const submissionId = await ctx.db.insert('learnResponses', { ...f.base, evidenceStatus: 'available', scopeKind: 'standalone', threadId: f.threadId, activityId: f.activityId, threadRevision: 1, activityRevision: 1, activityContractVersion: 'diagnostic.v1', responseSlotId: slotId, acceptedAt: f.base.createdAt, payloadDigest: 'diagnostic-hash', assistanceSnapshot: f.assistanceSnapshot, validitySnapshot: { ...f.validitySnapshot, measurementEligible: false }, bodyAvailability: 'available', currentEligibility: 'eligible', responseContractVersion: 'response.v1', disclosurePolicyVersion: 'disclosure.v1', receiptId: f.rows.learnResponseCommandReceipts })
      const bodyId = await ctx.db.insert('learnResponseBodies', { ...f.base, threadId: f.threadId, submissionId, payload: { kind: 'text', text: 'Diagnostic answer' }, payloadBytes: 17, payloadDigest: 'diagnostic-hash' })
      return { slotId, submissionId, bodyId }
    })
    const deletion = await t.run(ctx => initiateAdaptiveThreadDeletion(ctx, owner.tokenIdentifier, f.threadId))
    for (let batch = 0; batch < 20; batch++) {
      const result = await t.mutation(internal.learnAdaptiveCommands.runThreadDeletionJob, { jobId: deletion.jobId })
      if (result.state === 'complete') break
      if (batch === 19) throw new Error('Thread deletion did not complete')
    }
    for (const id of Object.values(standalone)) expect(await t.run(ctx => ctx.db.get(id))).toBeNull()
    expect(await t.run(ctx => ctx.db.get(f.rows.learnResponses))).not.toBeNull()
    expect(await t.run(ctx => ctx.db.get(f.rows.learnResponseBodies))).not.toBeNull()
    expect(await t.run(ctx => ctx.db.get(f.threadId))).toBeNull()
    await t.finishInProgressScheduledFunctions()
    vi.clearAllTimers()
  })

  test('completes bounded account deletion of every new collection and invalidates another requester’s snapshot', async () => {
    vi.useFakeTimers()
    const t = convexTest(schema, modules)
    const a = await t.run(ctx => seedMeasurementStorage(ctx, owner.tokenIdentifier))
    const b = await t.run(ctx => seedMeasurementStorage(ctx, foreign.tokenIdentifier))
    const cachedRowId = await t.run(async (ctx) => {
      const otherRow = await ctx.db.get(b.rows.learnMeasurementReportRows)
      if (!otherRow) throw new Error('Missing foreign source row')
      const { _id: _otherId, _creationTime: _otherCreationTime, ...otherFields } = otherRow
      const cachedRowId = await ctx.db.insert('learnMeasurementReportRows', { ...otherFields, reportRunId: a.rows.learnMeasurementReportRuns, sequence: 2 })
      const row = await ctx.db.get(a.rows.learnMeasurementReportRows)
      if (!row) throw new Error('Missing source row')
      await ctx.db.patch(row._id, { reportRunId: b.rows.learnMeasurementReportRuns })
      const catalog = await ctx.db.get(a.rows.learnAssessmentCatalogs)
      if (!catalog) throw new Error('Missing catalogue')
      const { _id: _id, _creationTime: _creationTime, ...fields } = catalog
      for (let index = 0; index < 9; index++) await ctx.db.insert('learnAssessmentCatalogs', fields)
      await ctx.db.insert('accountDeletionJobs', { userId: owner.tokenIdentifier, status: 'active', phase: 'documents', startedAt: Date.now(), updatedAt: Date.now() })
      return cachedRowId
    })
    for (let batch = 0; batch < 180; batch++) {
      const before = await t.run(async ctx => (await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', owner.tokenIdentifier)).take(20)).length)
      await t.mutation(internal.accountDeletion.runDeletionBatch, { userId: owner.tokenIdentifier })
      const after = await t.run(async ctx => (await ctx.db.query('learnAssessmentCatalogs').withIndex('by_userId', q => q.eq('userId', owner.tokenIdentifier)).take(20)).length)
      expect(before - after).toBeLessThanOrEqual(8)
      const state = await t.query(internal.accountDeletion.getDeletionTombstone, { userId: owner.tokenIdentifier })
      if (state?.phase === 'complete') break
      if (batch === 179) throw new Error('Account deletion did not complete')
    }
    expect(await t.query(internal.accountDeletion.getDeletionTombstone, { userId: owner.tokenIdentifier })).toMatchObject({ phase: 'complete' })
    for (const table of LEARN_MEASUREMENT_COLLECTIONS) {
      expect(await t.run(ctx => ctx.db.query(table).withIndex('by_userId', q => q.eq('userId', owner.tokenIdentifier)).take(1)), table).toEqual([])
      expect(await t.run(ctx => ctx.db.get(b.rows[table]))).not.toBeNull()
    }
    expect(await t.run(ctx => ctx.db.get(b.rows.learnMeasurementReportRuns))).toMatchObject({ status: 'stale' })
    expect(await t.run(ctx => ctx.db.get(cachedRowId))).toBeNull()
    await t.finishInProgressScheduledFunctions()
    vi.clearAllTimers()
  })
})
