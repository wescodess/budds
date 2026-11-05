import { v } from 'convex/values'
import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import { LEARN_MEASUREMENT_STORAGE_LIMITS, type LearnMeasurementCollection } from '../../shared/learn-v2-measurement-storage-manifest'

const BATCH_SIZE = LEARN_MEASUREMENT_STORAGE_LIMITS.pageSize
export const measurementSourceValidator = v.union(
  v.object({ kind: v.literal('snapshot'), id: v.id('learnSourceSnapshots') }),
  v.object({ kind: v.literal('excerpt'), id: v.id('learnSourceExcerpts') }),
  v.object({ kind: v.literal('document'), id: v.id('documents') }),
  v.object({ kind: v.literal('folder'), id: v.id('folders') }),
)
type Source = import('convex/values').Infer<typeof measurementSourceValidator>
type Reference = { collection: LearnMeasurementCollection, id: Id<LearnMeasurementCollection> }

export async function readMeasurementSourceDescendants(ctx: QueryCtx | MutationCtx, userId: string, source: Source): Promise<Reference[]> {
  const supports = source.kind === 'snapshot'
    ? await ctx.db.query('learnMeasurementSupports').withIndex('by_userId_and_sourceSnapshotId_and_invalidatedAt', q => q.eq('userId', userId).eq('sourceSnapshotId', source.id).eq('invalidatedAt', undefined)).take(BATCH_SIZE)
    : source.kind === 'excerpt'
      ? await ctx.db.query('learnMeasurementSupports').withIndex('by_userId_and_sourceExcerptId_and_invalidatedAt', q => q.eq('userId', userId).eq('sourceExcerptId', source.id).eq('invalidatedAt', undefined)).take(BATCH_SIZE)
      : []
  if (supports.length) return supports.map(row => ({ collection: 'learnMeasurementSupports', id: row._id }))
  const links = source.kind === 'snapshot'
    ? await ctx.db.query('learnResponseEvidenceLinks').withIndex('by_userId_and_dependency_sourceSnapshotId_and_invalidatedAt', q => q.eq('userId', userId).eq('dependency.sourceSnapshotId', source.id).eq('invalidatedAt', undefined)).take(BATCH_SIZE)
    : source.kind === 'document'
      ? await ctx.db.query('learnResponseEvidenceLinks').withIndex('by_userId_and_dependency_documentId_and_invalidatedAt', q => q.eq('userId', userId).eq('dependency.documentId', source.id).eq('invalidatedAt', undefined)).take(BATCH_SIZE)
      : source.kind === 'folder'
        ? await ctx.db.query('learnResponseEvidenceLinks').withIndex('by_userId_and_dependency_folderId_and_invalidatedAt', q => q.eq('userId', userId).eq('dependency.folderId', source.id).eq('invalidatedAt', undefined)).take(BATCH_SIZE)
        : []
  return links.map(row => ({ collection: 'learnResponseEvidenceLinks', id: row._id }))
}

export async function invalidateMeasurementReportRowsBatch(ctx: MutationCtx, userId: string) {
  const rows = await ctx.db.query('learnMeasurementReportRows')
    .withIndex('by_userId_and_invalidatedAt', q => q.eq('userId', userId).eq('invalidatedAt', undefined)).take(BATCH_SIZE)
  for (const row of rows) {
    const run = await ctx.db.get(row.reportRunId)
    if (run) await ctx.db.patch(run._id, { status: 'stale', reasonCode: 'source_invalidated' })
    await ctx.db.patch(row._id, { invalidatedAt: Date.now() })
  }
  return rows.length > 0
}

export async function deleteMeasurementReportRunsBatch(ctx: MutationCtx, userId: string) {
  const run = await ctx.db.query('learnMeasurementReportRuns').withIndex('by_userId', q => q.eq('userId', userId)).first()
  if (!run) return 0
  // Source rows belong to their learners; their cached snapshot still dies
  // with its requester-owned run. The exact parent index spans that roster.
  const rows = await ctx.db.query('learnMeasurementReportRows').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', run._id)).take(BATCH_SIZE)
  if (rows.length) {
    for (const row of rows) await ctx.db.delete(row._id)
    return rows.length
  }
  const cells = await ctx.db.query('learnMeasurementReportCells').withIndex('by_reportRunId_and_sequence', q => q.eq('reportRunId', run._id)).take(BATCH_SIZE)
  if (cells.length) {
    for (const cell of cells) await ctx.db.delete(cell._id)
    return cells.length
  }
  await ctx.db.delete(run._id)
  return 1
}

export async function invalidateMeasurementSourceBatch(ctx: MutationCtx, userId: string, source: Source) {
  if (await invalidateMeasurementReportRowsBatch(ctx, userId)) return true
  const references = await readMeasurementSourceDescendants(ctx, userId, source)
  for (const reference of references) {
    if (reference.collection === 'learnMeasurementSupports') {
      const support = await ctx.db.get(reference.id as Id<'learnMeasurementSupports'>)
      if (!support || support.userId !== userId) continue
      const [item, spec, claim] = await Promise.all([ctx.db.get(support.itemId), ctx.db.get(support.scoringSpecId), ctx.db.get(support.claimId)])
      if (item?.userId === userId) {
        await ctx.db.patch(item._id, { evidenceStatus: 'evidence_unavailable', invalidatedAt: Date.now(), prompt: undefined, declaredStimulus: undefined })
        const family = await ctx.db.get(item.familyId)
        if (family?.userId === userId) await ctx.db.patch(family._id, { evidenceStatus: 'evidence_unavailable', invalidatedAt: Date.now() })
      }
      if (spec?.userId === userId) await ctx.db.patch(spec._id, { evidenceStatus: 'evidence_unavailable', invalidatedAt: Date.now(), payload: undefined, referenceSolution: undefined, derivation: undefined })
      if (claim?.userId === userId) await ctx.db.patch(claim._id, { evidenceStatus: 'evidence_unavailable', invalidatedAt: Date.now(), claim: undefined })
      await ctx.db.patch(support._id, { evidenceStatus: 'evidence_unavailable', invalidatedAt: Date.now() })
    }
    else {
      const link = await ctx.db.get(reference.id as Id<'learnResponseEvidenceLinks'>)
      if (!link || link.userId !== userId) continue
      const bodies = await ctx.db.query('learnResponseBodies').withIndex('by_userId_and_submissionId', q => q.eq('userId', userId).eq('submissionId', link.submissionId)).take(BATCH_SIZE)
      for (const body of bodies) await ctx.db.delete(body._id)
      const response = await ctx.db.get(link.submissionId)
      if (response?.userId === userId) await ctx.db.patch(response._id, {
        evidenceStatus: 'evidence_unavailable', invalidatedAt: Date.now(), currentEligibility: 'excluded',
        bodyAvailability: 'purged', bodyUnavailableReason: 'evidence_unavailable', bodyPurgedAt: Date.now(),
      })
      // Drain even malformed duplicate bodies before consuming the dependency.
      if (bodies.length < BATCH_SIZE) await ctx.db.patch(link._id, { evidenceStatus: 'evidence_unavailable', invalidatedAt: Date.now() })
    }
  }
  return references.length > 0
}

type VoidChild = 'learnMeasurementReportRows' | 'learnResponseBodies' | 'learnResponseEvidenceLinks' | 'learnResponseIntegrityEvents' | 'learnResponseCommandReceipts' | 'learnScoringExecutions' | 'learnResponses' | 'learnResponseSlots' | 'learnAssessmentOpportunities' | 'learnMeasurementAssignments' | 'learnMeasurementSupports' | 'learnMeasurementClaims' | 'learnMeasurementScoringSpecs' | 'learnMeasurementItems' | 'learnMeasurementFamilies' | 'learnMeasurementValidations' | 'learnMeasurementReportFacts'
const VOID_CHILDREN: VoidChild[] = ['learnMeasurementReportRows', 'learnResponseBodies', 'learnResponseEvidenceLinks', 'learnResponseIntegrityEvents', 'learnResponseCommandReceipts', 'learnScoringExecutions', 'learnResponses', 'learnResponseSlots', 'learnAssessmentOpportunities', 'learnMeasurementAssignments', 'learnMeasurementSupports', 'learnMeasurementClaims', 'learnMeasurementScoringSpecs', 'learnMeasurementItems', 'learnMeasurementFamilies', 'learnMeasurementValidations', 'learnMeasurementReportFacts']
export async function readMeasurementVoidDescendants(ctx: QueryCtx | MutationCtx, userId: string, learningVoidId: Id<'learningVoids'>, table: VoidChild): Promise<Reference[]> {
  switch (table) {
    case 'learnMeasurementReportRows': return (await ctx.db.query('learnMeasurementReportRows').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnResponseBodies': return (await ctx.db.query('learnResponseBodies').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnResponseEvidenceLinks': return (await ctx.db.query('learnResponseEvidenceLinks').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnResponseIntegrityEvents': return (await ctx.db.query('learnResponseIntegrityEvents').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnResponseCommandReceipts': return (await ctx.db.query('learnResponseCommandReceipts').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnScoringExecutions': return (await ctx.db.query('learnScoringExecutions').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnResponses': return (await ctx.db.query('learnResponses').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnResponseSlots': return (await ctx.db.query('learnResponseSlots').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnAssessmentOpportunities': return (await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnMeasurementAssignments': return (await ctx.db.query('learnMeasurementAssignments').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnMeasurementSupports': return (await ctx.db.query('learnMeasurementSupports').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnMeasurementClaims': return (await ctx.db.query('learnMeasurementClaims').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnMeasurementScoringSpecs': return (await ctx.db.query('learnMeasurementScoringSpecs').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnMeasurementItems': return (await ctx.db.query('learnMeasurementItems').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnMeasurementFamilies': return (await ctx.db.query('learnMeasurementFamilies').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnMeasurementValidations': return (await ctx.db.query('learnMeasurementValidations').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnMeasurementReportFacts': return (await ctx.db.query('learnMeasurementReportFacts').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
  }
}
export async function deleteMeasurementVoidBatch(ctx: MutationCtx, userId: string, learningVoidId: Id<'learningVoids'>) {
  const events = await ctx.db.query('learnActivityEvents').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  for (const event of events) await ctx.db.delete(event._id)
  if (events.length) return true
  if (await invalidateMeasurementReportRowsBatch(ctx, userId)) return true
  for (const table of VOID_CHILDREN) {
    const rows = await readMeasurementVoidDescendants(ctx, userId, learningVoidId, table)
    for (const row of rows) await ctx.db.delete(row.id)
    if (rows.length) return true
  }
  const exposures = await ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', learningVoidId)).take(BATCH_SIZE)
  for (const exposure of exposures) await ctx.db.patch(exposure._id, { learningVoidId: undefined, blueprintRevisionId: undefined, objectiveId: undefined, studySessionId: undefined, assignmentId: undefined, assessmentOpportunityId: undefined })
  return exposures.length > 0
}

type ThreadChild = 'learnResponseBodies' | 'learnResponseEvidenceLinks' | 'learnResponseIntegrityEvents' | 'learnResponseCommandReceipts' | 'learnResponses' | 'learnResponseSlots'
const THREAD_CHILDREN: ThreadChild[] = ['learnResponseBodies', 'learnResponseEvidenceLinks', 'learnResponseIntegrityEvents', 'learnResponseCommandReceipts', 'learnResponses', 'learnResponseSlots']
export async function readMeasurementThreadDescendants(ctx: QueryCtx | MutationCtx, userId: string, threadId: Id<'learningThreads'>, table: ThreadChild): Promise<Reference[]> {
  switch (table) {
    case 'learnResponseBodies': return (await ctx.db.query('learnResponseBodies').withIndex('by_userId_and_threadId', q => q.eq('userId', userId).eq('threadId', threadId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnResponseEvidenceLinks': return (await ctx.db.query('learnResponseEvidenceLinks').withIndex('by_userId_and_threadId', q => q.eq('userId', userId).eq('threadId', threadId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnResponseIntegrityEvents': return (await ctx.db.query('learnResponseIntegrityEvents').withIndex('by_userId_and_threadId', q => q.eq('userId', userId).eq('threadId', threadId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnResponseCommandReceipts': return (await ctx.db.query('learnResponseCommandReceipts').withIndex('by_userId_and_threadId', q => q.eq('userId', userId).eq('threadId', threadId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnResponses': return (await ctx.db.query('learnResponses').withIndex('by_userId_and_threadId', q => q.eq('userId', userId).eq('threadId', threadId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
    case 'learnResponseSlots': return (await ctx.db.query('learnResponseSlots').withIndex('by_userId_and_threadId', q => q.eq('userId', userId).eq('threadId', threadId)).take(BATCH_SIZE)).map(row => ({ collection: table, id: row._id }))
  }
}
export async function deleteMeasurementThreadBatch(ctx: MutationCtx, userId: string, threadId: Id<'learningThreads'>) {
  for (const table of THREAD_CHILDREN) {
    const rows = await readMeasurementThreadDescendants(ctx, userId, threadId, table)
    for (const row of rows) await ctx.db.delete(row.id)
    if (rows.length) return true
  }
  const exposures = await ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_threadId', q => q.eq('userId', userId).eq('threadId', threadId)).take(BATCH_SIZE)
  for (const exposure of exposures) await ctx.db.patch(exposure._id, { threadId: undefined, activityId: undefined })
  return exposures.length > 0
}
