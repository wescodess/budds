import type { Id } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import type { LearnArtifactReference } from '../../shared/learn-v2-artifact-lineage'
import type { LearnHelpReference, LearnHelpRequest } from './learnV2HelpContract'
import { createResponsePrivacyReadContext } from './learnV2PrivacyReadContext'

type Target = LearnHelpReference
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
type Artifact = LearnArtifactReference['artifact']

export async function teachingReadScope(ctx: QueryCtx, userId: string, targets: Target[]): Promise<LearnHelpRequest['scope']> {
  ctx = createResponsePrivacyReadContext(ctx, userId, 256).ctx
  const references = new Map<string, LearnHelpReference>()
  const seen = new Set<string>()
  const lineages = new Set<string>()
  let edges = 0
  let rowsRead = 0
  const unavailable = (): never => { throw new Error('Teaching scope unavailable') }
  const bounded = <T>(rows: T[]) => { rowsRead += rows.length; if (rowsRead > 512) unavailable(); return rows }
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
    return rows.length > 0
  }
  async function target(value: Target, depth = 0): Promise<void> {
    const key = value.kind === 'share' ? `share:${value.token}` : `${value.kind}:${value.id}`
    if (seen.has(key)) return
    if (seen.size >= 256 || depth > 8) unavailable()
    seen.add(key)
    switch (value.kind) {
      case 'section': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) return unavailable()
        add({ kind: 'course', id: row.courseId })
        await artifact({ kind: 'section_block', id: row._id })
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
          if (question.sourceDocumentId) add({ kind: 'document', id: question.sourceDocumentId })
          const registered = await artifact({ kind: 'quiz_question', id: question._id })
          if (!registered && !question.sourceDocumentId) unavailable()
        }
        return
      }
      case 'attempt': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) return unavailable()
        return await target({ kind: 'quiz', id: row.quizId }, depth + 1)
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
          for (const id of [card.sourceDocumentId, card.metadata?.source?.documentId]) if (id) add({ kind: 'document', id })
          if (!row.activeVersionId && !card.sourceDocumentId && !card.metadata?.source?.documentId) unavailable()
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
          for (const id of [card.sourceDocumentId, card.metadata?.source?.documentId]) if (id) add({ kind: 'document', id })
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
        add({ kind: 'audio_job', id: row.jobId })
        return await target({ kind: 'audio_overview', id: row.audioOverviewId }, depth + 1)
      }
      case 'media': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) return unavailable()
        add({ kind: 'audio_job', id: row.jobId })
        return
      }
      case 'session': {
        const row = await ctx.db.get(value.id)
        const plan = row && await ctx.db.get(row.studyPlanRevisionId)
        if (!row || row.userId !== userId || !plan || plan.userId !== userId) return unavailable()
        add({ kind: 'learning_void', id: plan.learningVoidId })
        return
      }
      case 'blueprint': {
        const row = await ctx.db.get(value.id)
        if (!row || row.userId !== userId) return unavailable()
        add({ kind: 'learning_void', id: row.learningVoidId })
        return
      }
      case 'share': {
        const row = await ctx.db.query('audioOverviews').withIndex('by_shareToken', q => q.eq('shareToken', value.token)).unique()
        if (!row || row.userId !== userId) return unavailable()
        return await target({ kind: 'audio_overview', id: row._id }, depth + 1)
      }
      case 'audio_overview': await artifact({ kind: 'audio_overview', id: value.id }); add(value); return
      default: add(value)
    }
  }
  try {
    for (const value of targets) await target(value)
    return references.size ? { references: [...references.values()] } : null
  } catch { return null }
}
