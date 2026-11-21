import { publicReviewItem } from './publicReviewItem'
import { publicTask } from './publicTask'
import type { TableNames } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'
import { isCurrentTeachingReadScope, teachingReadScope, type TeachingReadTarget } from './learnV2TeachingReadScope'

const copies = new Set(['courses', 'courseSections', 'quizzes', 'quizQuestions', 'quizAttempts', 'quizAnswerAssessments', 'flashcards', 'flashcardSets', 'flashcardRoomCards', 'flashcardRoomVersions', 'flashcardVersionCards', 'reviewItems',
  'audioOverviewJobs', 'audioOverviewOutlines', 'audioOverviewLearningObjectives', 'audioOverviewClaims', 'audioOverviewEpisodes', 'audioOverviewScenes', 'audioOverviewUtterances', 'audioOverviewSceneQualityGates', 'audioOverviewAlignments', 'audioOverviewAlignmentSegments', 'audioOverviewJobTurns', 'audioOverviews', 'audioOverviewInterjections', 'audioOverviewInterjectionsV2', 'audioOverviewInterjectionUtterances'])

export async function exportTeachingCopy<T extends { _id: string, _creationTime: number }>(ctx: QueryCtx, userId: string, collection: string, value: T) {
  if (collection === 'tasks') {
    const id = ctx.db.normalizeId('tasks', value._id)
    const task = id && await ctx.db.get(id)
    if (!task || task.userId !== userId) throw new Error('Export unavailable')
    return { ...publicTask(ctx, task), evidenceStatus: 'evidence_unavailable' as const }
  }
  if (!copies.has(collection)) return value
  const row = value as T & Record<string, unknown>
  const id = <Table extends TableNames>(table: Table, field = '_id') => {
    const raw = row[field]
    return typeof raw === 'string' ? ctx.db.normalizeId(table, raw) : null
  }
  let target: TeachingReadTarget | null = null
  switch (collection) {
    case 'courses': { const key = id('courses'); if (key) target = { kind: 'course', id: key }; break }
    case 'courseSections': { const key = id('courseSections'); if (key) target = { kind: 'section', id: key }; break }
    case 'quizzes': { const key = id('quizzes'); if (key) target = { kind: 'quiz', id: key }; break }
    case 'quizQuestions': { const key = id('quizQuestions'); if (key) target = { kind: 'question', id: key }; break }
    case 'quizAttempts': { const key = id('quizAttempts'); if (key) target = { kind: 'attempt', id: key }; break }
    case 'quizAnswerAssessments': { const key = id('quizAttempts', 'attemptId'); if (key) target = { kind: 'attempt', id: key }; break }
    case 'reviewItems': { const key = id('reviewItems'); if (key) target = { kind: 'review_item', id: key }; break }
    case 'flashcards': { const key = id('documents', 'sourceDocumentId'); if (key) target = { kind: 'document', id: key }; break }
    case 'flashcardRoomCards': { const key = id('flashcardRoomCards'); if (key) target = { kind: 'card', id: key }; break }
    case 'flashcardRoomVersions': { const key = id('flashcardRoomVersions'); if (key) target = { kind: 'version', id: key }; break }
    case 'flashcardVersionCards': { const key = id('flashcardRoomVersions', 'versionId'); if (key) target = { kind: 'version', id: key }; break }
    case 'audioOverviews': { const key = id('audioOverviews'); if (key) target = { kind: 'audio_overview', id: key }; break }
    case 'audioOverviewInterjections': { const key = id('audioOverviewInterjections'); if (key) target = { kind: 'interjection', id: key }; break }
    case 'audioOverviewInterjectionsV2': { const key = id('audioOverviewInterjectionsV2'); if (key) target = { kind: 'interjection_v2', id: key }; break }
    case 'audioOverviewInterjectionUtterances': { const key = id('audioOverviewInterjectionsV2', 'interjectionId'); if (key) target = { kind: 'interjection_v2', id: key }; break }
    default: {
      const key = id('audioOverviewJobs', collection === 'audioOverviewJobs' ? '_id' : 'jobId')
      if (key) {
        const episode = await ctx.db.query('audioOverviewEpisodes').withIndex('by_jobId', q => q.eq('jobId', key)).unique()
        if (episode?.userId === userId && episode.compatibilityOverviewId) target = { kind: 'audio_overview', id: episode.compatibilityOverviewId }
      }
    }
  }
  if (target && isCurrentTeachingReadScope(await teachingReadScope(ctx, userId, [target]))) {
    if (target.kind === 'review_item') { const review = await ctx.db.get(target.id); if (review) return publicReviewItem(review) }
    return value
  }
  return { _id: value._id, _creationTime: value._creationTime, userId, evidenceStatus: 'evidence_unavailable' as const,
    ...(collection === 'quizAnswerAssessments' && typeof row.learnerAnswerSnapshot === 'string' ? { learnerAnswerSnapshot: row.learnerAnswerSnapshot } : {}),
    ...(collection === 'quizAttempts' && Array.isArray(row.answers) ? { answers: row.answers.map((answer: unknown) => {
      if (!answer || typeof answer !== 'object') return null
      const own = answer as Record<string, unknown>
      return { questionId: own.questionId, response: own.response, isCorrect: own.isCorrect }
    }) } : {}) }
}
