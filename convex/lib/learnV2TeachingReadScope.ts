import { LearnTeachingScopeError, LearnBlueprintAuthorityError } from '../../shared/learn-v2-errors'
import type { Doc, Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import type { LearnArtifactReference } from '../../shared/learn-v2-artifact-lineage'
import type { LearnHelpReference, LearnHelpRequest } from './learnV2HelpContract'
import { responsePrivacyReadContext } from './learnV2PrivacyReadContext'
import { messageReplayAccess, currentMessageSourceAccess } from './learnV2ReplayAccess'
import { sourceBodyAvailable } from './learnV2ResponsePrivacy'
import { admitArtifactInputsForOwner, admitArtifactInputsForRecord, admitArtifactInputsByIdentityForOwner, admitArtifactInputsByIdentityForRecord } from './learnV2ArtifactLineage'
import { getQuizAttemptAnswers, getQuizAttemptAssessments } from './quizGrading'
import { getOptionalAuthUserId } from './auth'
import { replayAdaptiveActivityPlan } from '../../shared/learn-adaptive-activity-plan'
import { storedPlan } from '../learnAdaptiveRecovery'
import { requireActiveBlueprint } from './learnV2BlueprintAuthority'

const currentScopes = new WeakSet<object>()
export const isCurrentTeachingReadScope = (scope: LearnHelpRequest['scope']) => scope !== null && currentScopes.has(scope)


export type TeachingReadTarget = LearnHelpReference
  | { kind: 'section', id: Id<'courseSections'> }
  | { kind: 'quiz', id: Id<'quizzes'> }
  | { kind: 'attempt', id: Id<'quizAttempts'> }
  | { kind: 'room', id: Id<'flashcardRooms'> }
  | { kind: 'version', id: Id<'flashcardRoomVersions'> }
  | { kind: 'interjection', id: Id<'audioOverviewInterjections'> }
  | { kind: 'interjection_v2', id: Id<'audioOverviewInterjectionsV2'> }
  | { kind: 'media', id: Id<'audioOverviewAudioArtifacts'> }
  | { kind: 'session', id: Id<'studySessions'> }
  | { kind: 'blueprint', id: Id<'learnBlueprintRevisions'> }
  | { kind: 'share', token: string }
  | { kind: 'review_item', id: Id<'reviewItems'> }
  | { kind: 'activity', id: Id<'learningThreadActivities'> }
  | { kind: 'session_content', id: Id<'sessionContent'> }
  | { kind: 'question', id: Id<'quizQuestions'> }
  | { kind: 'assessment', id: Id<'quizAnswerAssessments'> }
  | { kind: 'card', id: Id<'flashcardRoomCards'> }
type Artifact = LearnArtifactReference['artifact']

export async function teachingReadScope(ctx: QueryCtx, userId: string, targets: TeachingReadTarget[]): Promise<LearnHelpRequest['scope']> {
  const authenticated = await getOptionalAuthUserId(ctx)
  if (targets.length === 1 && targets[0]!.kind === 'share') {
    const row = await ctx.db.query('audioOverviews').withIndex('by_shareToken', q => q.eq('shareToken', targets[0]!.kind === 'share' ? targets[0]!.token : '')).unique()
    if (!row) return null
    userId = row.userId
  }
  ctx = responsePrivacyReadContext(ctx, userId)
  const artifacts = new Map<string, LearnArtifactReference>()
  let proofs = 0
  let record: { kind: 'document', id: Id<'documents'> } | { kind: 'audio_job', id: Id<'audioOverviewJobs'> } | null = null
  const references = new Map<string, LearnHelpReference>()
  const snapshotDocuments = new Set<Id<'documents'>>()
  const directDocuments = new Set<Id<'documents'>>()
  const seen = new Set<string>()
  const active = new Set<string>()
  const lineages = new Set<string>()
  let edges = 0
  let rowsRead = 0
  function unavailable(): never { throw new LearnTeachingScopeError('Teaching scope unavailable') }
  const bounded = <T>(rows: T[]) => { rowsRead += rows.length; if (rowsRead > 1024) unavailable(); return rows }
  const add = (reference: LearnHelpReference) => {
    references.set(`${reference.kind}:${reference.id}`, reference)
    if (references.size > 64) unavailable()
  }
  async function lineage(id: Id<'learnArtifactLineages'>, depth: number) {
    if (lineages.has(id)) return
    if (depth > 8 || lineages.size >= 64) unavailable()
    lineages.add(id)
    const row = await ctx.db.get(id)
    if (!row || row.userId !== userId || row.nextId || row.invalidatedAt !== undefined) unavailable()
    const sources = bounded(await ctx.db.query('learnArtifactSourceLinks').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', id)).take(65))
    const origins = bounded(await ctx.db.query('learnArtifactLineageOrigins').withIndex('by_userId_and_lineageId', q => q.eq('userId', userId).eq('lineageId', id)).take(9))
    edges += sources.length + origins.length
    if (sources.length > 64 || origins.length > 8 || edges > 256) unavailable()
    for (const source of sources) {
      if (source.invalidatedAt !== undefined || !source.dependency) unavailable()
      const dependency = source.dependency!
      if (dependency.kind === 'snapshot' || dependency.kind === 'excerpt') add({ kind: 'source_snapshot', id: dependency.sourceSnapshotId })
      else if (dependency.kind === 'document') add({ kind: 'document', id: dependency.documentId })
      else add({ kind: 'folder', id: dependency.folderId })
    }
    for (const origin of origins) await lineage(origin.originLineageId, depth + 1)
  }
  async function artifact(value: Artifact) {
    const rows = bounded(await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', value.kind).eq('artifact.id', value.id).eq('nextId', undefined)).take(17))
    if (rows.length > 16 || rows.some(row => row.userId !== userId)) unavailable()
    for (const row of rows) await lineage(row._id, 0)
    for (const row of rows) {
      artifacts.set(`${value.kind}:${value.id}:${row.key}`, { artifact: value, key: row.key, revision: row.revision, payloadDigest: row.payloadDigest })
      proofs++
    }
    return rows.length > 0
  }
  async function target(value: TeachingReadTarget, depth = 0, snapshotDocument = false): Promise<void> {
    if (value.kind === 'document' && !snapshotDocument) directDocuments.add(value.id)
    const key = value.kind === 'share' ? `share:${value.token}` : `${value.kind}:${value.id}`
    if (active.has(key)) unavailable()
    if (seen.has(key)) { proofs++; return }
    if (seen.size >= 512 || depth > 8) unavailable()
    active.add(key)
    const before = proofs
    await resolve(value, depth)
    if (proofs === before) unavailable()
    active.delete(key)
    seen.add(key)
  }
  async function blueprintSources(blueprint: Doc<'learnBlueprintRevisions'>, depth: number, allowUnaccepted: boolean) {
    const learningVoid = await ctx.db.get(blueprint.learningVoidId)
    const folder = learningVoid && await ctx.db.get(learningVoid.folderId)
    if (!learningVoid || learningVoid.userId !== userId || learningVoid.status === 'archived' || !folder || folder.userId !== userId) unavailable()
    // These references still establish check relevance when a source row is
    // metadata only. Body authority belongs to the selected projection below.
    add({ kind: 'learning_void', id: learningVoid._id })
    add({ kind: 'folder', id: folder._id })
    const sources = bounded(await ctx.db.query('learnSourceSnapshots').withIndex('by_userId_and_blueprintRevisionId', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id)).take(65))
    const objectives = bounded(await ctx.db.query('learnObjectives').withIndex('by_userId_and_blueprintRevisionId_and_order', q => q.eq('userId', userId).eq('blueprintRevisionId', blueprint._id)).take(17))
    if (sources.length > 64 || objectives.length > 16) unavailable()
    const dependencies = new Set<Id<'learnSourceSnapshots'>>()
    for (const objective of objectives) {
      const links = bounded(await ctx.db.query('learnObjectiveSources').withIndex('by_userId_and_objectiveId_and_sourceSnapshotId', q => q.eq('userId', userId).eq('objectiveId', objective._id)).take(65))
      if (links.length > 64) unavailable()
      for (const link of links) if (link.coverage !== 'gap') dependencies.add(link.sourceSnapshotId)
    }
    for (const source of sources) {
      if (source.learningVoidId !== learningVoid._id) unavailable()
      // Source review can return fetched/evaluated evidence; the mission only
      // returns accepted evidence. Unavailable, unused rows retain metadata.
      if (await sourceBodyAvailable(ctx, userId, source._id, { allowUnaccepted })) dependencies.add(source._id)
    }
    if (dependencies.size > 64) unavailable()
    for (const id of dependencies) {
      const source = await ctx.db.get(id)
      if (!source || source.userId !== userId || source.learningVoidId !== learningVoid._id) unavailable()
      await target({ kind: 'source_snapshot', id }, depth + 1)
    }
  }
  async function resolve(value: TeachingReadTarget, depth: number): Promise<void> {
    switch (value.kind) {
      case 'section': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) return unavailable()
        const course = await ctx.db.get(row.courseId)
        if (!course || course.userId !== userId) unavailable()
        if (!await artifact({ kind: 'section_block', id: row._id })) await target({ kind: 'course', id: row.courseId }, depth + 1)
        if (row.contentBlocks.length > 32) unavailable()
        for (const block of row.contentBlocks) {
          if (!block.entityId) continue
          if (block.type === 'quiz') { const id = ctx.db.normalizeId('quizzes', block.entityId); if (!id) unavailable(); await target({ kind: 'quiz', id: id! }, depth + 1) }
          else if (block.type === 'flashcard') { const id = ctx.db.normalizeId('flashcardRooms', block.entityId); if (!id) unavailable(); await target({ kind: 'room', id: id! }, depth + 1) }
          else if (block.type === 'audio') { const id = ctx.db.normalizeId('audioOverviews', block.entityId); if (!id) unavailable(); await target({ kind: 'audio_overview', id: id! }, depth + 1) }
        }
        return
      }
      case 'quiz': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) return unavailable()
        add({ kind: 'folder', id: row.folderId })
        const questions = bounded(await ctx.db.query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', row._id)).take(201))
        if (questions.length > 200) unavailable()
        for (const question of questions) {
          if (question.userId !== userId) unavailable()
          if (question.sourceDocumentId) await target({ kind: 'document', id: question.sourceDocumentId }, depth + 1)
          const registered = await artifact({ kind: 'quiz_question', id: question._id })
          if (!registered && !question.sourceDocumentId) unavailable()
        }
        return
      }
      case 'attempt': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) return unavailable()
        await target({ kind: 'quiz', id: row.quizId }, depth + 1)
        const answers = await getQuizAttemptAnswers(ctx, row)
        const assessments = bounded(await getQuizAttemptAssessments(ctx, row, answers))
        if (answers.length > 200 || assessments.length > 200) unavailable()
        for (const assessment of assessments) await target({ kind: 'assessment', id: assessment._id }, depth + 1)
        return
      }
      case 'room': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) return unavailable()
        add({ kind: 'folder', id: row.folderId })
        if (row.activeVersionId) await target({ kind: 'version', id: row.activeVersionId }, depth + 1)
        const cards = bounded(await ctx.db.query('flashcardRoomCards').withIndex('by_roomId', q => q.eq('roomId', row._id)).take(201))
        if (cards.length > 200) unavailable()
        for (const card of cards) {
          if (card.userId !== userId) unavailable()
          for (const id of [card.sourceDocumentId, card.metadata?.source?.documentId]) if (id) await target({ kind: 'document', id }, depth + 1)
          if (!row.activeVersionId && !card.sourceDocumentId && !card.metadata?.source?.documentId) unavailable()
        }
        if (row.activeVersionId) {
          const copies = bounded(await ctx.db.query('flashcardVersionCards').withIndex('by_versionId', q => q.eq('versionId', row.activeVersionId!)).take(201))
          if (copies.length > 200 || cards.some(card => !copies.some(copy => copy.userId === userId && copy.roomId === row._id
            && copy.displayOrder === card.displayOrder && copy.term === card.term && (copy.definition === card.definition || copy.definition === card.correctedDefinition)
            && copy.sourceDocumentId === card.sourceDocumentId && copy.metadata?.source?.documentId === card.metadata?.source?.documentId))) unavailable()
        }
        return
      }
      case 'version': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) return unavailable()
        const room = await ctx.db.get(row.roomId)
        if (!room || room.userId !== userId) return unavailable()
        add({ kind: 'folder', id: room.folderId })
        const registered = await artifact({ kind: 'flashcard_version', id: row._id })
        const cards = bounded(await ctx.db.query('flashcardVersionCards').withIndex('by_versionId', q => q.eq('versionId', row._id)).take(201))
        if (cards.length > 200) unavailable()
        for (const card of cards) {
          if (card.userId !== userId) unavailable()
          for (const id of [card.sourceDocumentId, card.metadata?.source?.documentId]) if (id) await target({ kind: 'document', id }, depth + 1)
          if (!registered && !card.sourceDocumentId && !card.metadata?.source?.documentId) unavailable()
        }
        return
      }
      case 'interjection': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) return unavailable()
        await artifact({ kind: 'audio_interjection', id: row._id })
        return await target({ kind: 'audio_overview', id: row.audioOverviewId }, depth + 1)
      }
      case 'interjection_v2': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) return unavailable()
        await artifact({ kind: 'audio_interjection_v2', id: row._id })
        await target({ kind: 'audio_job', id: row.jobId }, depth + 1)
        return await target({ kind: 'audio_overview', id: row.audioOverviewId }, depth + 1)
      }
      case 'media': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) return unavailable()
        const episode = await ctx.db.get(row.episodeId)
        if (!episode || episode.userId !== userId || !episode.compatibilityOverviewId) unavailable()
        if (row.interjectionId) await target({ kind: 'interjection_v2', id: row.interjectionId }, depth + 1)
        else await target({ kind: 'audio_overview', id: episode.compatibilityOverviewId }, depth + 1)
        return
      }
      case 'session': {
        const row = await ctx.db.get(value.id)
        const plan = row && await ctx.db.get(row.studyPlanRevisionId)
        if (!row || row.userId !== userId || !plan || plan.userId !== userId) return unavailable()
        add({ kind: 'learning_void', id: plan.learningVoidId })
        const content = row.status === 'in_progress'
          ? await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', userId).eq('studySessionId', row._id).eq('revision', row.startedSessionContentRevision!)).unique()
          : await ctx.db.query('sessionContent').withIndex('by_userId_and_studySessionId_and_revision', q => q.eq('userId', userId).eq('studySessionId', row._id)).order('desc').first()
        if (content) await target({ kind: 'session_content', id: content._id }, depth + 1)
        return
      }
      case 'blueprint': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) return unavailable()
        return await blueprintSources(row, depth, true)
      }
      case 'share': {
        const row = await ctx.db.query('audioOverviews').withIndex('by_shareToken', q => q.eq('shareToken', value.token)).unique()
        if (!row || row.userId !== userId) return unavailable()
        return await target({ kind: 'audio_overview', id: row._id }, depth + 1)
      }
      case 'review_item': {
        const row = await ctx.db.get(value.id)
        const card = row?.flashcardRoomCardId ? await ctx.db.get(row.flashcardRoomCardId) : null
        const section = row && await ctx.db.get(row.sectionId)
        if (!row || row.userId !== userId || !card || card.userId !== userId || !section || section.userId !== userId
          || section.courseId !== row.courseId || row.prompt !== card.term || row.answer !== card.definition) unavailable()
        if (!row.sourceVersionId) unavailable()
        const version = await ctx.db.get(row.sourceVersionId)
        if (!version || version.userId !== userId || version.roomId !== card.roomId) unavailable()
        const copies = bounded(await ctx.db.query('flashcardVersionCards').withIndex('by_versionId', q => q.eq('versionId', version._id)).take(201))
        if (copies.length > 200 || !copies.some(copy => copy.userId === userId && copy.displayOrder === card.displayOrder && copy.term === row.prompt && copy.definition === row.answer)) unavailable()
        await target({ kind: 'version', id: version._id }, depth + 1)
        await target({ kind: 'section', id: row.sectionId }, depth + 1)
        return await target({ kind: 'card', id: card._id }, depth + 1)
      }
      case 'card': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) unavailable()
        return await target({ kind: 'room', id: row.roomId }, depth + 1)
      }
      case 'assessment': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId || row.questionSnapshot.scopeVersion !== 'quiz.source-scope.v1') unavailable()
        if (row.questionSnapshot.sourceDocumentId) await target({ kind: 'document', id: row.questionSnapshot.sourceDocumentId }, depth + 1)
        return await target({ kind: 'question', id: row.questionId }, depth + 1)
      }
      case 'question': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) unavailable()
        const registered = await artifact({ kind: 'quiz_question', id: row._id })
        if (row.sourceDocumentId) await target({ kind: 'document', id: row.sourceDocumentId }, depth + 1)
        else if (!registered) unavailable()
        return
      }
      case 'audio_overview': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId || row.status !== 'ready') unavailable()
        const registered = await artifact({ kind: 'audio_overview', id: row._id })
        for (const id of new Set([...(row.sourceDocumentIds ?? []), ...(row.scopeDocIds ?? [])])) await target({ kind: 'document', id }, depth + 1)
        if (row.episodeId) {
          const episode = await ctx.db.get(row.episodeId)
          if (!episode || episode.userId !== userId) unavailable()
          await target({ kind: 'audio_job', id: episode.jobId }, depth + 1)
        } else if (!registered && !row.sourceDocumentIds?.length && !row.scopeDocIds?.length) unavailable()
        add(value)
        return
      }
      case 'audio_job': {
        const row = await ctx.db.get(value.id)
        const task = row && await ctx.db.get(row.taskId)
        if (!row || row.userId !== userId || !task || task.userId !== userId || ['failed', 'cancelled'].includes(row.status)) unavailable()
        record ??= { kind: 'audio_job', id: row._id }
        const entries = bounded(await ctx.db.query('audioOverviewSourceManifestEntries').withIndex('by_jobId', q => q.eq('jobId', row._id)).take(65))
        const ids = new Set([...(row.sourceDocumentIds ?? []), ...(task.audioOverviewRequest?.documents.map(item => item.documentId) ?? []), ...entries.map(entry => entry.documentId)])
        if (!ids.size || entries.length > 64 || entries.some(entry => entry.userId !== userId) || ids.size > 64) unavailable()
        for (const id of ids) await target({ kind: 'document', id }, depth + 1)
        for (const pin of [...entries, ...(task.audioOverviewRequest?.documents ?? []).map(item => ({ ...item, revision: item.sourceRevision, objectKey: item.r2Key }))]) {
          const document = await ctx.db.get(pin.documentId)
          if (!document || document.sourceRevision !== pin.revision || document.contentHash !== pin.contentHash || document.r2Key !== pin.objectKey || 'folderId' in pin && document.folderId !== pin.folderId) unavailable()
        }
        add(value)
        return
      }
      case 'course': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) unavailable()
        const links = bounded(await ctx.db.query('courseSourceDocs').withIndex('by_courseId', q => q.eq('courseId', row._id)).take(65))
        if (!links.length || links.length > 64) unavailable()
        for (const link of links) {
          if (link.userId !== userId || !link.documentId) unavailable()
          await target({ kind: 'document', id: link.documentId }, depth + 1)
        }
        add(value)
        return
      }
      case 'document': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId || row.status !== 'success') unavailable()
        record ??= { kind: 'document', id: row._id }
        add(value); proofs++
        return
      }
      case 'source_snapshot': {
        if (!await sourceBodyAvailable(ctx, userId, value.id, { allowUnaccepted: true })) unavailable()
        const row = (await ctx.db.get(value.id))!
        const identity = await ctx.db.get(row.sourceIdentityId)
        if (!identity || identity.userId !== userId) unavailable()
        if (identity.folderDocumentId) {
          snapshotDocuments.add(identity.folderDocumentId)
          await target({ kind: 'document', id: identity.folderDocumentId }, depth + 1, true)
        }
        add(value); proofs++
        return
      }
      case 'learning_void': {
        const row = await ctx.db.get(value.id)
        const folder = row && await ctx.db.get(row.folderId)
        if (!row || row.userId !== userId || row.status === 'archived' || !folder || folder.userId !== userId) unavailable()
        let blueprint: Doc<'learnBlueprintRevisions'> | null
        if (row.activeBlueprintRevisionId) blueprint = await requireActiveBlueprint(ctx, userId, row)
        else {
          if (!['draft', 'sourcing', 'source_review', 'map_review'].includes(row.status)) unavailable()
          const revisions = bounded(await ctx.db.query('learnBlueprintRevisions').withIndex('by_userId_and_learningVoidId', q => q.eq('userId', userId).eq('learningVoidId', row._id)).order('desc').take(33))
          if (revisions.length > 32) unavailable()
          revisions.sort((left, right) => right.revision - left.revision)
          blueprint = revisions.length === 1 || revisions[0]?.revision !== revisions[1]?.revision ? revisions[0] ?? null : null
        }
        if (!blueprint) unavailable()
        await blueprintSources(blueprint, depth, false)
        return
      }
      case 'thread': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId || row.deletionStartedAt !== undefined || !row.currentActivityId) unavailable()
        await target({ kind: 'activity', id: row.currentActivityId }, depth + 1)
        add(value)
        return
      }
      case 'activity': {
        const row = await ctx.db.get(value.id)
        const thread = row && await ctx.db.get(row.threadId)
        if (!row || row.userId !== userId || !thread || thread.userId !== userId || thread.deletionStartedAt !== undefined) unavailable()
        if (row.evidenceReferences.length > 64) unavailable()
        for (const reference of row.evidenceReferences) await target({ kind: 'source_snapshot', id: reference.sourceSnapshotId }, depth + 1)
        if (row.sessionContentId) await target({ kind: 'session_content', id: row.sessionContentId }, depth + 1)
        if (thread.sourceScope.kind === 'document') {
          const id = ctx.db.normalizeId('documents', thread.sourceScope.sourceId)
          if (!id) unavailable()
          await target({ kind: 'document', id: id! }, depth + 1)
        } else if (thread.learningVoidId) {
          if (row.evidenceReferences.length || row.sessionContentId) add({ kind: 'learning_void', id: thread.learningVoidId })
          else await target({ kind: 'learning_void', id: thread.learningVoidId }, depth + 1)
        }
        else if (row.activityClass === 'non_factual'
          && !row.evidenceReferences.length && !row.decisionInputs.sourceInputs.length && !row.sessionContentId && (await replayAdaptiveActivityPlan(storedPlan(row))).ok) {
          if (row.attribution) {
            const id = ctx.db.normalizeId('learningThreadContributions', row.attribution.contributionId)
            const contribution = id && await ctx.db.get(id)
            if (!contribution || contribution.userId !== userId || contribution.threadId !== thread._id || contribution.sourceStatus !== 'available' || contribution.sourceFeature !== 'chat') unavailable()
            const messageId = ctx.db.normalizeId('messages', contribution.sourceIdentity)
            const message = messageId && await ctx.db.get(messageId)
            if (!message || message.userId !== userId) unavailable()
            const access = await messageReplayAccess(ctx, userId, message)
            if (!access.ownText || message.sources?.length || message.model || message.interjectionContext) unavailable()
          }
          proofs++
        }
        else unavailable()
        add({ kind: 'thread', id: thread._id })
        return
      }
      case 'session_content': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) unavailable()
        const blocks = bounded(await ctx.db.query('sessionContentBlocks').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', row._id)).take(17))
        const claims = bounded(await ctx.db.query('sessionContentClaims').withIndex('by_userId_and_sessionContentId_and_order', q => q.eq('userId', userId).eq('sessionContentId', row._id)).take(33))
        if (blocks.length > 16 || claims.length > 32) unavailable()
        let registered = blocks.length > 0
        for (const block of blocks) registered = await artifact({ kind: 'session_block', id: block._id }) && registered
        for (const claim of claims) {
          const supports = bounded(await ctx.db.query('learnClaimSupports').withIndex('by_userId_and_sessionContentClaimId', q => q.eq('userId', userId).eq('sessionContentClaimId', claim._id)).take(9))
          if (!supports.length || supports.length > 8) unavailable()
          for (const support of supports) { if (!support.sourceSnapshotId) unavailable(); await target({ kind: 'source_snapshot', id: support.sourceSnapshotId }, depth + 1) }
        }
        if (!claims.length && !registered) unavailable()
        return
      }
      default: unavailable()
    }
  }
  try {
    for (const value of targets) await target(value)
    const docs = [...references.values()].filter((reference): reference is Extract<LearnHelpReference, { kind: 'document' }> => reference.kind === 'document')
    const direct = docs.filter(reference => !snapshotDocuments.has(reference.id) || directDocuments.has(reference.id))
    if (direct.length && !await currentMessageSourceAccess(ctx, userId, direct)) unavailable()
    if (snapshotDocuments.size) {
      // Explicit snapshot dependencies already checked their exact current
      // document pins. Unrelated historical snapshots are not body authority;
      // the backing document still needs its current producer-lineage check.
      for (const id of snapshotDocuments) {
        const document = await ctx.db.get(id)
        if (!document || document.userId !== userId || document.status !== 'success') unavailable()
        let folderId: Id<'folders'> | undefined = document.folderId
        const ancestors = new Set<string>()
        while (folderId) {
          if (ancestors.has(folderId) || ancestors.size >= 8) unavailable()
          ancestors.add(folderId)
          const folder: Doc<'folders'> | null = await ctx.db.get(folderId)
          if (!folder || folder.userId !== userId) unavailable()
          folderId = folder.parentId
        }
      }
      const input = { artifacts: [...snapshotDocuments].map(id => ({ kind: 'document' as const, id })) }
      const admission = authenticated === userId
        ? await admitArtifactInputsByIdentityForOwner(ctx, userId, input)
        : record ? await admitArtifactInputsByIdentityForRecord(ctx, record, input) : null
      if (!admission || admission.status === 'rejected') unavailable()
    }
    for (const reference of references.values()) if (reference.kind === 'source_snapshot' && !await sourceBodyAvailable(ctx, userId, reference.id, { allowUnaccepted: true })) unavailable()
    if (artifacts.size) {
      if (artifacts.size > 64) unavailable()
      const input = { references: [...artifacts.values()] }
      const admission = authenticated === userId
        ? await admitArtifactInputsForOwner(ctx, userId, input)
        : record ? await admitArtifactInputsForRecord(ctx, record, input) : null
      if (!admission || admission.status === 'rejected') unavailable()
    }
    if (!proofs) return null
    const scope = { references: [...references.values()] }
    currentScopes.add(scope)
    return scope
  } catch (error) {
    if (!(error instanceof LearnTeachingScopeError || error instanceof LearnBlueprintAuthorityError)) throw error
    return null
  }
}
