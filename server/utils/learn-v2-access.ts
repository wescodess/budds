import type { H3Event } from 'h3'
import { api } from '../../convex/_generated/api'
import type { LearnV2PublicStatus } from '../../convex/lib/learnV2Access'
import { makeConvexClient } from './convex-client'

type LearnV2Handler<Result> = (event: H3Event) => Result | Promise<Result>
type AllowedLearnV2Status = Extract<LearnV2PublicStatus, { kind: 'allowed' }>

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function isAllowedLearnV2Status(value: unknown): value is AllowedLearnV2Status {
  if (typeof value !== 'object' || value === null) return false
  const status = value as Record<string, unknown>
  if (!hasExactKeys(status, ['kind', 'capabilities']) || status.kind !== 'allowed') return false
  if (typeof status.capabilities !== 'object' || status.capabilities === null) return false

  const capabilities = status.capabilities as Record<string, unknown>
  return hasExactKeys(capabilities, ['entry', 'read', 'write', 'jobAdmission'])
    && capabilities.entry === true
    && capabilities.read === true
    && capabilities.write === true
    && capabilities.jobAdmission === true
}

export function defineLearnV2Handler<Result>(handler: LearnV2Handler<Result>) {
  return defineEventHandler(async (event): Promise<Result> => {
    const token = event.context.convexToken as string | undefined
    if (!token) {
      throw createError({ statusCode: 401, message: 'Authentication required' })
    }

    const client = makeConvexClient(event)
    if (!client) {
      throw createError({ statusCode: 503, message: 'Learn experience unavailable' })
    }

    let decision: unknown
    try {
      decision = await client.query(api.learnV2Access.status, {})
    }
    catch {
      throw createError({ statusCode: 503, message: 'Learn experience unavailable' })
    }
    if (!isAllowedLearnV2Status(decision)) {
      throw createError({ statusCode: 404, message: 'Not found' })
    }

    return await handler(event)
  })
}
