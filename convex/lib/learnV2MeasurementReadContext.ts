import type { MutationCtx, QueryCtx } from '../_generated/server'
import { LEARN_MEASUREMENT_CAPABILITIES } from '../../shared/learn-v2-measurement-storage-manifest'
import { createResponsePrivacyReadContext } from './learnV2PrivacyReadContext'

type ReadCtx = QueryCtx | MutationCtx
const owner = Symbol('measurementReadOwner')

export function hasMeasurementReadContext(ctx: Pick<ReadCtx, 'db'>, userId: string): ctx is ReadCtx & { [owner]: { userId: string, db: ReadCtx['db'] } } {
  const scope = Reflect.get(ctx, owner) as { userId: string, db: ReadCtx['db'] } | undefined
  return scope?.userId === userId && scope.db === ctx.db
}

// Pass the returned context for every read and write in the delivery invocation.
export function measurementReadContext<T extends ReadCtx>(ctx: T, userId: string): T {
  if (!LEARN_MEASUREMENT_CAPABILITIES.responses) return ctx
  const existing = Reflect.get(ctx, owner) as { userId: string, db: ReadCtx['db'] } | undefined
  if (existing !== undefined) {
    if (existing.userId !== userId) throw new Error('Learn measurement read owner mismatch')
    if (existing.db === ctx.db) return ctx
  }
  const reads = createResponsePrivacyReadContext(ctx, userId, undefined, { throwOnBudgetExhaustion: true })
  const db = new Proxy(ctx.db, {
    get(target, property) {
      const method: unknown = Reflect.get(reads.ctx.db, property)
      if (typeof method !== 'function') return method
      if (['insert', 'patch', 'replace', 'delete'].includes(String(property))) return async (...args: unknown[]) => {
        let writtenId: unknown
        try {
          const result = await Reflect.apply(Reflect.get(target, property), target, args)
          writtenId = property === 'insert' ? result : args.at(property === 'delete' ? -1 : -2)
          return result
        }
        finally {
          reads.afterWrite(typeof writtenId === 'string' ? writtenId : undefined)
        }
      }
      return (...args: unknown[]) => Reflect.apply(Reflect.get(reads.ctx.db, property), reads.ctx.db, args)
    },
  })
  const scope = { userId, db }
  return new Proxy(ctx, { get: (_target, property) => property === owner ? scope : property === 'db' ? db : Reflect.get(reads.ctx, property) })
}
