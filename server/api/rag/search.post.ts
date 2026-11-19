import type { Id } from '../../../convex/_generated/dataModel'
import { createHelpAdmissionGuard } from '../../utils/learn-v2-help-admission'
import { makeConvexClient } from '../../utils/convex-client'
import { loadTeachingScope, assertTeachingSourcePins } from '../../utils/teaching-source-scope'

export default defineEventHandler(async (event) => {
  const userId = getConvexTokenIdentifier(event)

  const body = await readBody<{
    query: string
    folderId?: string
    max_num_results?: number
    score_threshold?: number
  }>(event)

  if (!body.query?.trim()) {
    throw createError({ statusCode: 400, message: 'query is required' })
  }

  const client = makeConvexClient(event)
  if (!client) throw createError({ statusCode: 503, message: 'Convex client unavailable' })
  const authorizeHelp = createHelpAdmissionGuard(event, { kind: 'search',
    scope: body.folderId ? { references: [{ kind: 'folder', id: body.folderId as Id<'folders'> }] } : null }, client)
  await authorizeHelp()
  const teachingScope = await loadTeachingScope(client, { folderId: body.folderId as Id<'folders'> | undefined })
  await authorizeHelp()
  const result = await searchDocuments({
    teachingScope,
    query: body.query,
    userId,
    folderId: body.folderId,
    max_num_results: body.max_num_results,
    score_threshold: body.score_threshold,
  })
  const current = await loadTeachingScope(client, { documentIds: teachingScope.map(source => source.documentId) })
  for (const chunk of result.data) assertTeachingSourcePins(current, chunk.attributes)
  await authorizeHelp()
  return result
})
