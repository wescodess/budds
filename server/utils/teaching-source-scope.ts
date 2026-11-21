import type { ConvexHttpClient } from 'convex/browser'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import type { H3Event } from 'h3'
import { api } from '../../convex/_generated/api'
import type { LearnHelpReference } from '../../convex/lib/learnV2HelpContract'
import { createHelpAdmissionGuard } from './learn-v2-help-admission'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../../shared/learn-v2-measurement-storage-manifest'

export type TeachingSource = FunctionReturnType<typeof api.documents.getTeachingScope>[number]
export class TeachingSourceError extends Error {
  readonly statusCode = 403
  constructor() { super('Teaching input is unavailable') }
}
export async function loadTeachingScope(client: ConvexHttpClient | null, scope: FunctionArgs<typeof api.documents.getTeachingScope>) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return undefined
  if (!client) throw new TeachingSourceError()
  const documents = await client.query(api.documents.getTeachingScope, scope)
  if (!Array.isArray(documents)) throw new TeachingSourceError()
  return documents
}
export function createTeachingHelpGuard(event: H3Event, client: ConvexHttpClient,
  scope: FunctionArgs<typeof api.documents.getTeachingScope>, kind: 'chat' | 'audio' = 'chat') {
  const references: LearnHelpReference[] = scope.courseId ? [{ kind: 'course', id: scope.courseId }]
    : scope.folderId ? [{ kind: 'folder', id: scope.folderId }]
      : (scope.documentIds ?? []).map(id => ({ kind: 'document', id }))
  const authorize = createHelpAdmissionGuard(event, { kind, ordinaryOnly: true, scope: references.length ? { references } : null }, client)
  let frozen: TeachingSource[] | undefined
  return async () => {
    if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return undefined
    await authorize()
    const current = await loadTeachingScope(client, scope)
    if (frozen) for (const source of frozen) assertTeachingSourcePins(current, source)
    frozen ??= current
    await authorize()
    return frozen
  }
}
export function assertTeachingCommand(body: unknown, fields: Record<string, 'string' | 'number' | 'strings' | 'object'>) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TeachingSourceError()
  for (const [key, value] of Object.entries(body)) {
    if (!Object.hasOwn(fields, key)) throw new TeachingSourceError()
    if (value === undefined) continue
    const type = fields[key]
    if (type === 'strings' ? !Array.isArray(value) || value.some(item => typeof item !== 'string')
      : type === 'object' ? !value || typeof value !== 'object' || Array.isArray(value)
        : typeof value !== type) throw new TeachingSourceError()
  }
}
export function assertTeachingSourcePins(scope: TeachingSource[] | undefined, input: { documentId?: string, folderId?: string, sourceRevision?: string, contentHash?: string }) {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return
  if (!scope) throw new TeachingSourceError()
  const source = scope.find(source => source.documentId === input.documentId)
  if (!source || input.folderId && source.folderId !== input.folderId || source.sourceRevision && source.sourceRevision !== input.sourceRevision
    || source.contentHash && source.contentHash.toLowerCase() !== input.contentHash?.toLowerCase()) throw new TeachingSourceError()
}
