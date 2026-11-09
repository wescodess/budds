import { ConvexError, v } from 'convex/values'
import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { LearnArtifactOwnerRecord, LearnArtifactPreparationArgs, LearnArtifactReference } from '../../shared/learn-v2-artifact-lineage'
import {
  admitArtifactInputsByIdentityForOwner, admitArtifactInputsByIdentityForRecord,
  repinArtifactLineageDescendantsForOwner, repinArtifactLineageDescendantsForRecord,
  createArtifactLineagePublicationContext, isArtifactRegistrationRequiredForOwner,
  isArtifactRegistrationRequiredForRecord, prepareAndRegisterInstructionalArtifactsForOwner,
  prepareAndRegisterInstructionalArtifactsForRecord,
} from './learnV2ArtifactLineage'

type ReadCtx = QueryCtx | MutationCtx
type Artifact = LearnArtifactReference['artifact']
type Output = LearnArtifactPreparationArgs['artifacts'][number]
const budgets = new WeakMap<ReadCtx, unknown>()
export function teachingPublication<T extends ReadCtx>(ctx: T) {
  const existing = budgets.get(ctx) as ReturnType<typeof createArtifactLineagePublicationContext<T>> | undefined
  if (existing) return existing
  const publication = createArtifactLineagePublicationContext(ctx)
  budgets.set(ctx, publication)
  return publication
}
function isMutationContext(ctx: ReadCtx): ctx is MutationCtx { return 'insert' in ctx.db }
export function teachingUnavailable(): never { throw new Error('Teaching input is unavailable') }

export async function assertTeachingInputs(ctx: ReadCtx, userId: string, artifacts: Artifact[], record?: LearnArtifactOwnerRecord) {
  const unique = [...new Map(artifacts.map(artifact => [`${artifact.kind}:${artifact.id}`, artifact])).values()]
  const publication = teachingPublication(ctx)
  for (let i = 0; i < unique.length; i += 64) {
    const input = { artifacts: unique.slice(i, i + 64) }
    let result = record
      ? await admitArtifactInputsByIdentityForRecord(publication.admission.ctx, record, input)
      : await admitArtifactInputsByIdentityForOwner(publication.admission.ctx, userId, input)
    if (result.status === 'rejected' && result.reasonCode === 'lineage_unavailable' && isMutationContext(ctx)) {
      const required = record
        ? await isArtifactRegistrationRequiredForRecord(publication.admission.ctx, record)
        : await isArtifactRegistrationRequiredForOwner(publication.admission.ctx, userId)
      if (required) {
        for (let offset = 0; offset < input.artifacts.length; offset += 50) {
          const artifacts = input.artifacts.slice(offset, offset + 50).filter((artifact): artifact is Output['artifact'] => ['document', 'document_chunk', 'quiz_question', 'section_block', 'flashcard_version', 'audio_overview', 'audio_interjection', 'audio_interjection_v2'].includes(artifact.kind))
          if (!artifacts.length) continue
          const preparation = teachingPublication(ctx).preparation.ctx
          if (record) await repinArtifactLineageDescendantsForRecord(preparation, record, { artifacts })
          else await repinArtifactLineageDescendantsForOwner(preparation, userId, { artifacts })
        }
        result = record
          ? await admitArtifactInputsByIdentityForRecord(publication.admission.ctx, record, input)
          : await admitArtifactInputsByIdentityForOwner(publication.admission.ctx, userId, input)
      }
    }
    if (result.status === 'rejected') {
      if (result.reasonCode === 'projection_exceeds_budget') throw new ConvexError({ status: 'rejected', reasonCode: result.reasonCode })
      teachingUnavailable()
    }
  }
}

export async function teachingDocuments(ctx: ReadCtx, userId: string, ids: readonly string[], record?: LearnArtifactOwnerRecord) {
  const documents: Doc<'documents'>[] = []
  const scope = teachingPublication(ctx).admission.ctx
  for (const raw of new Set(ids)) {
    const id = scope.db.normalizeId('documents', raw)
    const document = id && await scope.db.get(id)
    if (!document || document.userId !== userId) teachingUnavailable()
    documents.push(document)
  }
  await assertTeachingInputs(ctx, userId, documents.map(document => ({ kind: 'document', id: document._id })), record)
  return documents
}

export async function publishTeaching(ctx: MutationCtx, userId: string, artifacts: Array<Pick<Output, 'artifact' | 'key'> & Partial<Pick<Output, 'sources' | 'origins'>>>, record?: LearnArtifactOwnerRecord) {
  const publication = teachingPublication(ctx)
  const required = record
    ? await isArtifactRegistrationRequiredForRecord(publication.preparation.ctx, record)
    : await isArtifactRegistrationRequiredForOwner(publication.preparation.ctx, userId)
  if (!required) return
  const expanded = [...artifacts]
  for (const member of artifacts) {
    const active = await publication.admission.ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', member.artifact.kind).eq('artifact.id', member.artifact.id).eq('nextId', undefined)).take(17)
    if (active.length > 16 || active.some(row => row.userId !== userId)) teachingUnavailable()
    for (const row of active) expanded.push({ ...member, key: row.key })
  }
  const unique = [...new Map(expanded.map(member => [`${member.artifact.kind}:${member.artifact.id}:${member.key}`, member])).values()]
  for (let i = 0; i < unique.length; i += 50) {
    const input = { artifacts: unique.slice(i, i + 50).map(member => ({ ...member, sources: member.sources ?? [], origins: member.origins ?? [] })) }
    if (record) await prepareAndRegisterInstructionalArtifactsForRecord(publication.preparation.ctx, record, input)
    else await prepareAndRegisterInstructionalArtifactsForOwner(publication.preparation.ctx, userId, input)
  }
}

export async function assertQuizTeaching(ctx: ReadCtx, userId: string, quizId: Id<'quizzes'>) {
  const questions = await ctx.db.query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', quizId)).take(201)
  if (questions.length > 200 || questions.some(question => question.userId !== userId)) teachingUnavailable()
  await assertTeachingInputs(ctx, userId, questions.map(question => ({ kind: 'quiz_question', id: question._id })))
  return questions
}
export async function assertSectionTeaching(ctx: ReadCtx, section: Doc<'courseSections'>) {
  if (section.contentBlocks.length) await assertTeachingInputs(ctx, section.userId, [{ kind: 'section_block', id: section._id }])
}
export async function assertRoomTeaching(ctx: ReadCtx, userId: string, roomId: Id<'flashcardRooms'>) {
  const room = await ctx.db.get(roomId)
  if (!room || room.userId !== userId) teachingUnavailable()
  if (room.activeVersionId) await assertTeachingInputs(ctx, userId, [{ kind: 'flashcard_version', id: room.activeVersionId }])
  else {
    const required = await isArtifactRegistrationRequiredForOwner(teachingPublication(ctx).admission.ctx, userId)
    const versions = await ctx.db.query('flashcardRoomVersions').withIndex('by_roomId', q => q.eq('roomId', roomId)).take(101)
    if (versions.length > 100) teachingUnavailable()
    await assertTeachingInputs(ctx, userId, versions.map(version => ({ kind: 'flashcard_version', id: version._id })))
    const cards = await ctx.db.query('flashcardRoomCards').withIndex('by_roomId', q => q.eq('roomId', roomId)).take(201)
    if (cards.length > 200 || required && (cards.length > 0 || versions.length > 0)) teachingUnavailable()
    await teachingDocuments(ctx, userId, cards.flatMap(card => [card.sourceDocumentId, card.metadata?.source?.documentId].filter((id): id is Id<'documents'> => !!id)))
  }
}

async function sectionMembers(ctx: ReadCtx, section: Doc<'courseSections'>, sources: Output['sources']): Promise<Output[]> {
  const rows = await ctx.db.query('learnArtifactLineages')
    .withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'section_block').eq('artifact.id', section._id).eq('nextId', undefined)).take(17)
  if (rows.length > 16 || rows.some(row => row.userId !== section.userId)) teachingUnavailable()
  const keys = new Set([...rows.map(row => row.key), ...section.contentBlocks.map(block => `block.${block.order}`)])
  if (!keys.size) keys.add('whole')
  return [...keys].map(key => ({ artifact: { kind: 'section_block', id: section._id }, key, sources, origins: [] }))
}
export async function publishSections(ctx: MutationCtx, userId: string, sections: Doc<'courseSections'>[], components: Array<Pick<Output, 'artifact' | 'key'> & Partial<Pick<Output, 'sources' | 'origins'>>> = [], sources: Output['sources'] = []) {
  if (!await isArtifactRegistrationRequiredForOwner(teachingPublication(ctx).preparation.ctx, userId)) return
  const members = [...components]
  for (const section of sections) if (['ready', 'completed'].includes(section.status)) members.push(...await sectionMembers(ctx, section, sources))
  await publishTeaching(ctx, userId, members)
}
export async function publishContainingSections(ctx: MutationCtx, userId: string, entityId: string, components: Array<Pick<Output, 'artifact' | 'key'> & Partial<Pick<Output, 'sources' | 'origins'>>> = []) {
  if (!await isArtifactRegistrationRequiredForOwner(teachingPublication(ctx).preparation.ctx, userId)) return
  const sections = await ctx.db.query('courseSections').withIndex('by_userId', q => q.eq('userId', userId)).take(101)
  if (sections.length > 100) teachingUnavailable()
  await publishSections(ctx, userId, sections.filter(section => section.contentBlocks.some(block => block.entityId === entityId)), components)
}

export async function assertAudioTeaching(ctx: ReadCtx, overview: Doc<'audioOverviews'>, session = true) {
  let record: LearnArtifactOwnerRecord | undefined
  if (!session) {
    const episode = overview.episodeId && await ctx.db.get(overview.episodeId)
    if (episode && episode.userId === overview.userId) record = { kind: 'audio_job', id: episode.jobId }
    else {
      for (const id of overview.sourceDocumentIds ?? []) {
        const document = await ctx.db.get(id)
        if (document?.userId === overview.userId && document.status === 'success') { record = { kind: 'document', id }; break }
      }
    }
    if (!record) teachingUnavailable()
  }
  await assertTeachingInputs(ctx, overview.userId, [{ kind: 'audio_overview', id: overview._id }], record)
}

export async function assertAudioJobSources(ctx: ReadCtx, job: Doc<'audioOverviewJobs'>, session = false) {
  const task = await ctx.db.get(job.taskId)
  if (!task || task.userId !== job.userId || !task.audioOverviewRequest) teachingUnavailable()
  const documents = await teachingDocuments(ctx, job.userId, task.audioOverviewRequest.documents.map(document => String(document.documentId)), session ? undefined : { kind: 'audio_job', id: job._id })
  for (const frozen of task.audioOverviewRequest.documents) {
    const live = documents.find(document => document._id === frozen.documentId)
    if (!live || live.sourceRevision !== frozen.sourceRevision || live.contentHash !== frozen.contentHash || live.r2Key !== frozen.r2Key) teachingUnavailable()
  }
  const episode = await ctx.db.query('audioOverviewEpisodes').withIndex('by_jobId', q => q.eq('jobId', job._id)).unique()
  if (episode?.compatibilityOverviewId) {
    const overview = await ctx.db.get(episode.compatibilityOverviewId)
    if (!overview || overview.userId !== job.userId) teachingUnavailable()
    await assertAudioTeaching(ctx, overview, session)
  }
}

export async function assertBlockInputs(ctx: ReadCtx, userId: string, blocks: Doc<'courseSections'>['contentBlocks']) {
  for (const block of blocks) {
    if (!block.entityId || block.type === 'text') continue
    if (block.type === 'quiz') {
      const id = ctx.db.normalizeId('quizzes', block.entityId)
      const quiz = id && await ctx.db.get(id)
      if (!quiz || quiz.userId !== userId) teachingUnavailable()
      await assertQuizTeaching(ctx, userId, quiz._id)
    } else if (block.type === 'flashcard') {
      const id = ctx.db.normalizeId('flashcardRooms', block.entityId)
      if (!id) teachingUnavailable()
      await assertRoomTeaching(ctx, userId, id)
    } else {
      const id = ctx.db.normalizeId('audioOverviews', block.entityId)
      const overview = id && await ctx.db.get(id)
      if (!overview || overview.userId !== userId) teachingUnavailable()
      await assertAudioTeaching(ctx, overview)
    }
  }
}

export async function cardCopyOrigins(ctx: ReadCtx, userId: string, versionId?: Id<'flashcardRoomVersions'>): Promise<Output['origins']> {
  if (!versionId) return []
  const rows = await ctx.db.query('learnArtifactLineages').withIndex('by_artifact_kind_and_artifact_id_and_nextId', q => q.eq('artifact.kind', 'flashcard_version').eq('artifact.id', versionId).eq('nextId', undefined)).take(9)
  if (rows.length > 8 || rows.some(row => row.userId !== userId)) teachingUnavailable()
  return rows.map(row => ({ reference: { artifact: { kind: 'flashcard_version', id: versionId }, key: row.key, revision: row.revision, payloadDigest: row.payloadDigest }, transformation: 'copy' }))
}

export async function publishCardRoom(ctx: MutationCtx, userId: string, roomId: Id<'flashcardRooms'>, previousVersionId?: Id<'flashcardRoomVersions'>) {
  if (!await isArtifactRegistrationRequiredForOwner(teachingPublication(ctx).preparation.ctx, userId)) return
  const room = await ctx.db.get(roomId)
  if (!room || room.userId !== userId) teachingUnavailable()
  let versionId = room.activeVersionId
  if (!versionId) {
    const cards = await ctx.db.query('flashcardRoomCards').withIndex('by_roomId', q => q.eq('roomId', roomId)).take(201)
    if (cards.length > 200) teachingUnavailable()
    versionId = await ctx.db.insert('flashcardRoomVersions', { userId, roomId, title: room.title, origin: 'manual', cardCount: cards.length })
    for (const card of cards) await ctx.db.insert('flashcardVersionCards', { userId, roomId, versionId, displayOrder: card.displayOrder,
      term: card.term, definition: card.correctedDefinition ?? card.definition, metadata: card.metadata, sourceDocumentId: card.sourceDocumentId,
      sourceChunkContent: card.sourceChunkContent, sourceFilename: card.sourceFilename })
    await ctx.db.patch(roomId, { activeVersionId: versionId, currentCardCount: cards.length })
  }
  await publishContainingSections(ctx, userId, roomId, [{ artifact: { kind: 'flashcard_version', id: versionId }, key: 'whole', origins: await cardCopyOrigins(ctx, userId, previousVersionId) }])
}

export const teachingSourcePinsValidator = v.array(v.object({ documentId: v.id('documents'), sourceRevision: v.optional(v.string()), contentHash: v.optional(v.string()) }))
export async function admitTeachingSourcePins(ctx: ReadCtx, userId: string, pins: Array<{ documentId: Id<'documents'>, sourceRevision?: string, contentHash?: string }>) {
  if (pins.length > 64) teachingUnavailable()
  const documents = await teachingDocuments(ctx, userId, pins.map(pin => pin.documentId))
  for (const pin of pins) {
    const current = documents.find(document => document._id === pin.documentId)
    if (!current || current.sourceRevision !== pin.sourceRevision || current.contentHash !== pin.contentHash) teachingUnavailable()
  }
  return documents.flatMap(document => document.sourceRevision ? [{ kind: 'document' as const, documentId: document._id, sourceRevision: document.sourceRevision }] : [])
}


export async function assertInterjectionTeaching(ctx: ReadCtx, userId: string, interjection: Doc<'audioOverviewInterjections'> | Doc<'audioOverviewInterjectionsV2'>) {
  const overview = await ctx.db.get(interjection.audioOverviewId)
  if (!overview || overview.userId !== userId) teachingUnavailable()
  await assertAudioTeaching(ctx, overview)
  await assertTeachingInputs(ctx, userId, ['answerTurns' in interjection ? { kind: 'audio_interjection', id: interjection._id } : { kind: 'audio_interjection_v2', id: interjection._id }])
}
export async function interjectionAnswerAvailable(ctx: ReadCtx, userId: string, interjection: Doc<'audioOverviewInterjections'> | Doc<'audioOverviewInterjectionsV2'>) {
  try { await assertInterjectionTeaching(ctx, userId, interjection); return true }
  catch { return false }
}


export async function publishCorrectedCardRoom(ctx: MutationCtx, userId: string, roomId: Id<'flashcardRooms'>) {
  if (!await isArtifactRegistrationRequiredForOwner(teachingPublication(ctx).preparation.ctx, userId)) return
  const room = await ctx.db.get(roomId)
  if (!room || room.userId !== userId) teachingUnavailable()
  await ctx.db.patch(roomId, { activeVersionId: undefined })
  await publishCardRoom(ctx, userId, roomId, room.activeVersionId)
}
