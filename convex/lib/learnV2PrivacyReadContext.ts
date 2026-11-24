import { LEARN_MEASUREMENT_CAPABILITIES } from '../../shared/learn-v2-measurement-storage-manifest'
import type { MutationCtx, QueryCtx } from '../_generated/server'

type ReadCtx = QueryCtx | MutationCtx
export const RESPONSE_PRIVACY_READ_BUDGET = 3072
const scopeKey = Symbol('responsePrivacyReadScope')
class PrivacyReadBudgetExceeded extends Error {}
type Scope = { memo: Map<string, Promise<unknown>>, exhausted: () => boolean, throwOnBudgetExhaustion: boolean, invalidate: () => void, requireStrict: () => void }

function readScope(ctx: ReadCtx): Scope | undefined {
  const scope = Reflect.get(ctx, scopeKey) as Scope | undefined
  return scope ?? (LEARN_MEASUREMENT_CAPABILITIES.responses ? Reflect.get(ctx.db, scopeKey) as Scope | undefined : undefined)
}

// Construct at a handler boundary. Nothing is retained outside this context;
// callers that write must start a new scope before reading changed authority.
export function createResponsePrivacyReadContext<T extends ReadCtx>(ctx: T, userId: string, limit = RESPONSE_PRIVACY_READ_BUDGET - 16, options: { throwOnBudgetExhaustion?: boolean } = {}) {
  // Authentication at the handler boundary uses at most sixteen ranges.
  limit = Math.min(limit, RESPONSE_PRIVACY_READ_BUDGET - 16)
  const throwOnBudgetExhaustion = options.throwOnBudgetExhaustion === true || propagatesResponseReadBudget(ctx)
  const documents = new Map<string, Promise<unknown>>()
  let reads = 0
  const charge = () => {
    if (reads >= limit) throw new PrivacyReadBudgetExceeded(state.throwOnBudgetExhaustion ? 'Learn source validation budget exhausted'
      : LEARN_MEASUREMENT_CAPABILITIES.responses ? 'Learn source validation unavailable: read_budget_exhausted' : undefined)
    reads++
  }
  const state: Scope = { memo: new Map(), exhausted: () => reads >= limit, throwOnBudgetExhaustion, invalidate: () => {
    documents.clear(); state.memo.clear(); invalidateResponsePrivacyReadContext(ctx)
  }, requireStrict: () => {
    state.throwOnBudgetExhaustion = true
    readScope(ctx)?.requireStrict()
  } }
  if (throwOnBudgetExhaustion) state.requireStrict()
  const db = new Proxy(ctx.db, {
    get(target, property) {
      if (property === scopeKey) return state
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
  readScope(ctx)?.invalidate()
}

export function responsePrivacyReadContext<T extends ReadCtx>(ctx: T, userId: string): T {
  return readScope(ctx) ? ctx : createResponsePrivacyReadContext(ctx, userId).ctx
}

export function privacyReadBudgetExhausted(ctx: ReadCtx) {
  return readScope(ctx)?.exhausted() ?? false
}

export async function privacyRead<T>(ctx: ReadCtx, userId: string, key: readonly unknown[], unavailable: T, read: (ctx: ReadCtx) => Promise<T>): Promise<T> {
  ctx = responsePrivacyReadContext(ctx, userId)
  const scope = readScope(ctx)!
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

export function propagatesResponseReadBudget(ctx: ReadCtx): boolean {
  return readScope(ctx)?.throwOnBudgetExhaustion === true
}
