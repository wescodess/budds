import type { H3Event } from 'h3'
import { api } from '../../convex/_generated/api'
import type { AdaptiveLearnPublicStatus } from '../../convex/lib/adaptiveLearnAccess'
import { makeConvexClient } from './convex-client'

type Allowed = Extract<AdaptiveLearnPublicStatus, { kind: 'allowed' }>
function isAllowed(value: unknown): value is Allowed {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'capabilities,kind' || row.kind !== 'allowed' || !row.capabilities || typeof row.capabilities !== 'object') return false
  const capabilities = row.capabilities as Record<string, unknown>
  return Object.keys(capabilities).sort().join(',') === 'entry,jobAdmission,read,write'
    && capabilities.entry === true && capabilities.read === true && capabilities.write === true && capabilities.jobAdmission === true
}

export function defineAdaptiveLearnHandler<Result>(handler: (event: H3Event) => Result | Promise<Result>) {
  return defineEventHandler(async (event): Promise<Result> => {
    if (!event.context.convexToken) throw createError({ statusCode: 401, message: 'Authentication required' })
    const client = makeConvexClient(event)
    if (!client) throw createError({ statusCode: 503, message: 'Learn experience unavailable' })
    let decision: unknown
    try { decision = await client.query(api.learnAdaptiveAccess.adaptiveStatus, {}) }
    catch { throw createError({ statusCode: 503, message: 'Learn experience unavailable' }) }
    if (!isAllowed(decision)) throw createError({ statusCode: 404, message: 'Not found' })
    return await handler(event)
  })
}
