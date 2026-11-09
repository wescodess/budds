import type { ConvexHttpClient } from 'convex/browser'
import type { FunctionArgs, FunctionReturnType } from 'convex/server'
import { api } from '../../convex/_generated/api'

export type TeachingSource = FunctionReturnType<typeof api.documents.getTeachingScope>[number]
export class TeachingSourceError extends Error {
  readonly statusCode = 403
  constructor() { super('Teaching input is unavailable') }
}
export async function loadTeachingScope(client: ConvexHttpClient, scope: FunctionArgs<typeof api.documents.getTeachingScope>) {
  const documents = await client.query(api.documents.getTeachingScope, scope)
  if (!Array.isArray(documents)) throw new TeachingSourceError()
  return documents
}
export function assertTeachingCommand(body: unknown, fields: Record<string, 'string' | 'number' | 'strings' | 'object'>) {
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
export function assertTeachingSourcePins(scope: TeachingSource[], input: { documentId?: string, sourceRevision?: string, contentHash?: string }) {
  const source = scope.find(source => source.documentId === input.documentId)
  if (!source || source.sourceRevision && source.sourceRevision !== input.sourceRevision
    || source.contentHash && source.contentHash.toLowerCase() !== input.contentHash?.toLowerCase()) throw new TeachingSourceError()
}
