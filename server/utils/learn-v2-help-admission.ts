import type { H3Event } from 'h3'
import type { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import { LEARN_HELP_ADMISSION_VERSION, helpAdmissionKey, type LearnHelpAdmission, type LearnHelpRequest } from '../../convex/lib/learnV2HelpContract'
import { makeConvexClient } from './convex-client'

export function createHelpAdmissionGuard(event: H3Event, input: Pick<LearnHelpRequest, 'kind' | 'scope'>, existingClient?: ConvexHttpClient) {
  const client = existingClient ?? makeConvexClient(event)
  if (!client) throw createError({ statusCode: 500, message: 'Convex client unavailable' })
  const suppliedKey = getRequestHeader(event, 'idempotency-key')
  if (suppliedKey && suppliedKey.length > 512) throw createError({ statusCode: 400, message: 'Invalid request' })
  const key = helpAdmissionKey(`nitro:${input.kind}`, suppliedKey || crypto.randomUUID())
  return async () => {
    const result: LearnHelpAdmission = await client.mutation(api.learnV2Assistance.admitHelp, {
      version: LEARN_HELP_ADMISSION_VERSION, ...input, idempotencyKey: await key,
    })
    if (result?.version !== LEARN_HELP_ADMISSION_VERSION) throw createError({ statusCode: 503, message: 'Service unavailable' })
    if (result.status === 'denied') throw createError({ statusCode: 403, message: 'Forbidden', data: result })
    if (result?.status !== 'ordinary' && result?.status !== 'authorized') throw createError({ statusCode: 503, message: 'Service unavailable' })
  }
}
