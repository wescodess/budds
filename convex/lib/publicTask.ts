import type { Doc } from '../_generated/dataModel'
import type { QueryCtx } from '../_generated/server'

export function publicTask(ctx: Pick<QueryCtx, 'db'>, row: Doc<'tasks'>) {
  const references = (input: unknown) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
    const value = input as Record<string, unknown>
    const result: Record<string, string | number> = {}
    for (const [field, table] of [['roomId', 'flashcardRooms'], ['versionId', 'flashcardRoomVersions'], ['quizId', 'quizzes'], ['courseId', 'courses'], ['overviewId', 'audioOverviews']] as const) {
      if (typeof value[field] !== 'string') continue
      const id = ctx.db.normalizeId(table, value[field])
      if (id) result[field] = id
    }
    for (const field of ['cardCount', 'questionCount'] as const) if (typeof value[field] === 'number' && Number.isSafeInteger(value[field]) && value[field] >= 0) result[field] = value[field]
    return Object.keys(result).length ? result : undefined
  }
  return { _id: row._id, _creationTime: row._creationTime, userId: row.userId, folderId: row.folderId, type: row.type,
    title: row.title, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt, completedAt: row.completedAt,
    metadata: references(row.metadata), result: references(row.result),
    ...(row.error ? { error: 'Task unavailable' } : {}), ...(row.progress ? { progress: row.status === 'completed' ? 'Completed' : 'Processing' } : {}) }
}
