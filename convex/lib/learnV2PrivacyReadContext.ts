import type { MutationCtx, QueryCtx } from '../_generated/server'

type ReadCtx = QueryCtx | MutationCtx
export const RESPONSE_PRIVACY_READ_BUDGET = 3072
const scopeKey = Symbol('responsePrivacyReadScope')
class PrivacyReadBudgetExceeded extends Error {}
type Scope = { memo: Map<string, Promise<unknown>>, exhausted: () => boolean, throwOnBudgetExhaustion: boolean, invalidate: () => void }

// Construct at a handler boundary. Nothing is retained outside this context;
// callers that write must start a new scope before reading changed authority.
export function createResponsePrivacyReadContext<T extends ReadCtx>(ctx: T, userId: string, limit = RESPONSE_PRIVACY_READ_BUDGET - 16, options: { throwOnBudgetExhaustion?: boolean } = {}) {
  // Authentication at the handler boundary uses at most sixteen ranges.
  limit = Math.min(limit, RESPONSE_PRIVACY_READ_BUDGET - 16)
  const documents = new Map<string, Promise<unknown>>()
  let reads = 0
  const charge = () => {
    if (reads >= limit) throw new PrivacyReadBudgetExceeded(options.throwOnBudgetExhaustion ? 'Learn source validation budget exhausted' : undefined)
    reads++
  }
  const state: Scope = { memo: new Map(), exhausted: () => reads >= limit, throwOnBudgetExhaustion: options.throwOnBudgetExhaustion === true, invalidate: () => {
    documents.clear(); state.memo.clear(); invalidateResponsePrivacyReadContext(ctx)
  } }
  const db = new Proxy(ctx.db, {
    get(target, property) {
      const method: unknown = Reflect.get(target, property)
      if (typeof method !== 'function') return method
      if (property === 'get') return (...args: unknown[]) => {
        const key = JSON.stringify([userId, args.at(-1)])
        const cached = documents.get(key)
        if (cached) return cached
        charge()
        const result = Promise.resolve(Reflect.apply(method, target, args))
        documents.set(key, result)
        return result
      }
      if (property === 'query') return (...args: unknown[]) => {
        charge()
        return Reflect.apply(method, target, args)
      }
      return method.bind(target)
    },
  })
  const scoped = new Proxy(ctx, { get: (target, property) => property === scopeKey ? state : property === 'db' ? db : Reflect.get(target, property) })
  return { ctx: scoped, get reads() { return reads } }
}

export function invalidateResponsePrivacyReadContext(ctx: ReadCtx) {
  (Reflect.get(ctx, scopeKey) as Scope | undefined)?.invalidate()
}

export function responsePrivacyReadContext<T extends ReadCtx>(ctx: T, userId: string): T {
  return Reflect.get(ctx, scopeKey) ? ctx : createResponsePrivacyReadContext(ctx, userId).ctx
}

export function privacyReadBudgetExhausted(ctx: ReadCtx) {
  return (Reflect.get(ctx, scopeKey) as Scope | undefined)?.exhausted() ?? false
}

export async function privacyRead<T>(ctx: ReadCtx, userId: string, key: readonly unknown[], unavailable: T, read: (ctx: ReadCtx) => Promise<T>): Promise<T> {
  ctx = responsePrivacyReadContext(ctx, userId)
  const scope = Reflect.get(ctx, scopeKey) as Scope
  if (scope.exhausted()) {
    if (scope.throwOnBudgetExhaustion) throw new PrivacyReadBudgetExceeded('Learn source validation budget exhausted')
    return unavailable
  }
  const cacheKey = JSON.stringify([userId, ...key])
  const cached = scope.memo.get(cacheKey)
  if (cached) return await cached as T
  const result = (async () => {
    try { return await read(ctx) }
    catch (error) {
      if (!(error instanceof PrivacyReadBudgetExceeded) || scope.throwOnBudgetExhaustion) throw error
      return unavailable
    }
  })()
  scope.memo.set(cacheKey, result)
  return await result
}
