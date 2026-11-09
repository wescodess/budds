import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx } from '../_generated/server'
import { requireAuth } from './auth'
import { privacyDigest } from './learnV2ResponsePrivacy'
import { prepareLearnResponseAssistanceForOwner } from './learnV2Responses'
import { LEARN_V2_PUBLIC_API_VERSION, parsePublicLearnRequest } from './learnV2PublicContract'
import { LEARN_MEASUREMENT_CAPABILITIES, LEARN_MEASUREMENT_STORAGE_VERSION } from '../../shared/learn-v2-measurement-storage-manifest'
import { LEARN_V2_ASSISTANCE_POLICY_VERSION } from '../../shared/learn-v2-responses'
import { LEARN_HELP_ADMISSION_VERSION, LEARN_HELP_LIMITS, LEARN_HELP_OPEN_PHASES, admitHelpSchema,
  type LearnHelpAdmission, type LearnHelpRequest, type LearnHelpReference } from './learnV2HelpContract'

type Scope = { voids: Set<string>, threads: Set<string>, folders: Set<string>, ancestors: Set<string>, sources: Set<string> }
class ScopeUnavailable extends Error {}
class ScopeUnknown extends Error {}
const emptyScope = (): Scope => ({ voids: new Set(), threads: new Set(), folders: new Set(), ancestors: new Set(), sources: new Set() })
const overlap = (left: Set<string>, right: Set<string>) => [...left].some(id => right.has(id))
function relevant(left: Scope, right: Scope) {
  return overlap(left.voids, right.voids) || overlap(left.threads, right.threads) || overlap(left.sources, right.sources)
    || overlap(left.folders, right.ancestors) || overlap(right.folders, left.ancestors)
}

// Only owned metadata is used here. No source body, prompt or answer is hashed,
// returned, logged, or used as an authority supplied by a client.
function scopeResolver(ctx: MutationCtx, userId: string) {
  const voidSources = new Map<string, Promise<Doc<'learnSourceSnapshots'>[]>>()
  async function folder(scope: Scope, id: Id<'folders'>) {
    scope.folders.add(id)
    let current: Id<'folders'> | undefined = id
    const seen = new Set<string>()
    while (current) {
      if (seen.has(current) || seen.size >= LEARN_HELP_LIMITS.folderDepth) throw new ScopeUnknown()
      seen.add(current)
      const row: Doc<'folders'> | null = await ctx.db.get(current)
      if (!row || row.userId !== userId) throw new ScopeUnavailable()
      scope.ancestors.add(current)
      current = row.parentId
    }
  }
  async function document(scope: Scope, id: Id<'documents'>) {
    const row = await ctx.db.get(id)
    if (!row || row.userId !== userId) throw new ScopeUnavailable()
    scope.sources.add(`document:${id}`)
    await folder(scope, row.folderId)
  }
  async function source(scope: Scope, row: Doc<'learnSourceSnapshots'>) {
    if (row.userId !== userId) throw new ScopeUnavailable()
    scope.sources.add(`snapshot:${row._id}`)
    const identity = await ctx.db.get(row.sourceIdentityId)
    if (!identity || identity.userId !== userId || identity.learningVoidId !== row.learningVoidId || identity.tombstonedAt !== undefined) throw new ScopeUnavailable()
    scope.sources.add(`identity:${identity._id}`)
    if (identity.origin !== 'folder_document') scope.sources.add(`external:${identity.origin}:${identity.externalKey}`)
    if (identity.canonicalUrl) scope.sources.add(`url:${identity.canonicalUrl}`)
    if (identity.folderDocumentId) await document(scope, identity.folderDocumentId)
    else if (identity.origin === 'folder_document') throw new ScopeUnknown()
    if (row.folderId) await folder(scope, row.folderId)
  }
  async function learningVoid(scope: Scope, id: Id<'learningVoids'>) {
    if (scope.voids.has(id)) return
    const row = await ctx.db.get(id)
    if (!row || row.userId !== userId || row.status === 'archived') throw new ScopeUnavailable()
    scope.voids.add(id)
    await folder(scope, row.folderId)
    let pending = voidSources.get(id)
    if (!pending) {
      pending = ctx.db.query('learnSourceSnapshots').withIndex('by_userId_and_learningVoidId_and_status', q => q.eq('userId', userId).eq('learningVoidId', id)).take(LEARN_HELP_LIMITS.sources + 1)
      voidSources.set(id, pending)
    }
    const sources = await pending
    if (sources.length > LEARN_HELP_LIMITS.sources) throw new ScopeUnknown()
    for (const row of sources) await source(scope, row)
  }
  async function thread(scope: Scope, id: Id<'learningThreads'>) {
    const row = await ctx.db.get(id)
    if (!row || row.userId !== userId || row.deletionStartedAt !== undefined) throw new ScopeUnavailable()
    scope.threads.add(id)
    if (row.learningVoidId) await learningVoid(scope, row.learningVoidId)
    if (row.sourceScope.kind === 'folder') {
      const id = ctx.db.normalizeId('folders', row.sourceScope.sourceId)
      if (!id) throw new ScopeUnknown()
      await folder(scope, id)
    } else if (row.sourceScope.kind === 'document') {
      const id = ctx.db.normalizeId('documents', row.sourceScope.sourceId)
      if (!id) throw new ScopeUnknown()
      await document(scope, id)
    } else if (row.sourceScope.kind !== 'none') throw new ScopeUnknown()
  }
  async function audioJob(scope: Scope, id: Id<'audioOverviewJobs'>) {
    const row = await ctx.db.get(id)
    if (!row || row.userId !== userId || ['failed', 'cancelled'].includes(row.status)) throw new ScopeUnavailable()
    await folder(scope, row.folderId)
    const entries = await ctx.db.query('audioOverviewSourceManifestEntries').withIndex('by_jobId', q => q.eq('jobId', id)).take(LEARN_HELP_LIMITS.sources + 1)
    const ids = new Set([...(row.sourceDocumentIds ?? []), ...entries.map(entry => {
      if (entry.userId !== userId) throw new ScopeUnavailable()
      return entry.documentId
    })])
    if (entries.length > LEARN_HELP_LIMITS.sources || ids.size > LEARN_HELP_LIMITS.sources) throw new ScopeUnknown()
    for (const id of ids) await document(scope, id)
  }
  async function reference(scope: Scope, reference: LearnHelpReference) {
    switch (reference.kind) {
      case 'folder': return await folder(scope, reference.id)
      case 'document': return await document(scope, reference.id)
      case 'learning_void': return await learningVoid(scope, reference.id)
      case 'thread': return await thread(scope, reference.id)
      case 'source_snapshot': {
        const row = await ctx.db.get(reference.id)
        if (!row || row.userId !== userId) throw new ScopeUnavailable()
        await learningVoid(scope, row.learningVoidId)
        return await source(scope, row)
      }
      case 'conversation': {
        const row = await ctx.db.get(reference.id)
        if (!row || row.userId !== userId) throw new ScopeUnavailable()
        return await folder(scope, row.folderId)
      }
      case 'audio_job': return await audioJob(scope, reference.id)
      case 'audio_overview': {
        const row = await ctx.db.get(reference.id)
        if (!row || row.userId !== userId || row.status !== 'ready') throw new ScopeUnavailable()
        await folder(scope, row.folderId)
        const ids = new Set([...(row.sourceDocumentIds ?? []), ...(row.scopeDocIds ?? [])])
        if (ids.size > LEARN_HELP_LIMITS.sources) throw new ScopeUnknown()
        for (const id of ids) await document(scope, id)
        if (row.episodeId) {
          const episode = await ctx.db.get(row.episodeId)
          if (!episode || episode.userId !== userId || episode.folderId !== row.folderId) throw new ScopeUnavailable()
          await audioJob(scope, episode.jobId)
        }
      }
    }
  }
  return { reference, learningVoid, thread }
}

async function recordDenial(ctx: MutationCtx, userId: string, row: Doc<'learnAssessmentOpportunities'>,
  request: LearnHelpRequest, reason: string, scopeDigest: string) {
  const receiptHash = await privacyDigest(['help-denied', request.idempotencyKey, request.kind, scopeDigest, row._id, row.revision, reason])
  const existing = await ctx.db.query('learnAssessmentExposures').withIndex('by_userId_and_deliveryReceiptHash', q => q.eq('userId', userId).eq('deliveryReceiptHash', receiptHash)).unique()
  if (existing) return
  const now = Date.now()
  await ctx.db.insert('learnAssessmentExposures', { userId, storageVersion: LEARN_MEASUREMENT_STORAGE_VERSION, createdAt: now,
    learningVoidId: row.learningVoidId, blueprintRevisionId: row.blueprintRevisionId, objectiveId: row.objectiveId, assessmentOpportunityId: row._id,
    ...(row.contextPins.kind === 'session' ? { studySessionId: row.contextPins.studySessionId,
      ...(row.contextPins.canvas ? { threadId: row.contextPins.canvas.threadId, activityId: row.contextPins.canvas.activityId } : {}) } : {}),
    purpose: 'assistance_requested_denied', status: 'requested_denied', projectionDigest: scopeDigest,
    deliveryReceiptHash: receiptHash, serverTime: now, policyVersion: LEARN_V2_ASSISTANCE_POLICY_VERSION,
    provenanceVersion: LEARN_HELP_ADMISSION_VERSION })
}

export async function admitLearnHelpForOwner(ctx: MutationCtx, userId: string, input: LearnHelpRequest): Promise<LearnHelpAdmission> {
  if (await requireAuth(ctx) !== userId) throw new Error('Learn access denied')
  const request = parsePublicLearnRequest(admitHelpSchema, input)
  const ordinary: LearnHelpAdmission = { version: LEARN_HELP_ADMISSION_VERSION, status: 'ordinary' }
  const deny = (reasonCode: 'test_open' | 'disclosure_unknown' | 'unavailable'): LearnHelpAdmission => ({ version: LEARN_HELP_ADMISSION_VERSION, status: 'denied', reasonCode })
  // No opportunity creator can run with this capability off. This grants no
  // opportunity-bound permission and creates no exposure for ordinary work.
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return ordinary
  const open: Doc<'learnAssessmentOpportunities'>[] = []
  for (const phase of LEARN_HELP_OPEN_PHASES) {
    const rows = await ctx.db.query('learnAssessmentOpportunities').withIndex('by_userId_and_phase', q => q.eq('userId', userId).eq('phase', phase))
      .take(LEARN_HELP_LIMITS.openOpportunities + 1 - open.length)
    open.push(...rows)
    if (open.length > LEARN_HELP_LIMITS.openOpportunities) return deny('disclosure_unknown')
  }
  if (!open.length) return ordinary
  if (!request.scope) {
    const scopeDigest = await privacyDigest({ kind: request.kind, scope: null })
    for (const row of open) await recordDenial(ctx, userId, row, request, 'disclosure_unknown', scopeDigest)
    return deny('disclosure_unknown')
  }
  const matches: Doc<'learnAssessmentOpportunities'>[] = []
  try {
    const resolver = scopeResolver(ctx, userId)
    const scope = emptyScope()
    for (const reference of request.scope.references) await resolver.reference(scope, reference)
    for (const row of open) {
      if (row.submissionId) throw new ScopeUnavailable()
      const assessment = emptyScope()
      await resolver.learningVoid(assessment, row.learningVoidId)
      if (row.contextPins.kind === 'session' && row.contextPins.canvas) await resolver.thread(assessment, row.contextPins.canvas.threadId)
      if (relevant(scope, assessment)) matches.push(row)
    }
  } catch (error) {
    const reason = error instanceof ScopeUnknown ? 'disclosure_unknown' : 'unavailable'
    const scopeDigest = await privacyDigest({ kind: request.kind, scope: request.scope })
    for (const row of open) await recordDenial(ctx, userId, row, request, reason, scopeDigest)
    return deny(reason)
  }
  if (!matches.length) return ordinary
  const scopeDigest = await privacyDigest({ kind: request.kind, scope: request.scope })
  const key = `help_${(await privacyDigest([request.idempotencyKey, request.kind, scopeDigest])).slice(7)}`
  const preparations = []
  for (const row of matches) {
    const prepared = await prepareLearnResponseAssistanceForOwner(ctx, userId, { version: LEARN_V2_PUBLIC_API_VERSION,
      kind: request.kind, idempotencyKey: key, assessmentOpportunityId: row._id }).catch(() => null)
    preparations.push(prepared)
  }
  const unavailable = preparations.some(value => !value || 'status' in value)
  const testOnly = preparations.some(value => value && !('status' in value) && value.denied)
  if (unavailable || testOnly) {
    const reason = unavailable ? 'unavailable' : 'test_open'
    for (const row of matches) await recordDenial(ctx, userId, row, request, reason, scopeDigest)
    return deny(reason)
  }
  const authorizations = []
  for (const prepared of preparations) {
    if (!prepared || 'status' in prepared) throw new Error('Help admission unavailable')
    const result = await prepared.commit()
    // A commit failure escapes the mutation, rolling back every exposure.
    if (result.status !== 'authorized') throw new Error('Help admission unavailable')
    authorizations.push({ assessmentOpportunityId: prepared.row._id, authorizationId: result.authorizationId })
  }
  return { version: LEARN_HELP_ADMISSION_VERSION, status: 'authorized', authorizations }
}
