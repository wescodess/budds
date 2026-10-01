import { internalQuery, type MutationCtx, type QueryCtx } from '../_generated/server'
import { ConvexError, v } from 'convex/values'
import { hasLearnV2Access } from './learnV2Access'

export type AdaptiveLearnFallbackRoute =
  | { name: 'app-learn', href: '/app/learn?legacy=v2', label: 'Open V2 learning plans' }
  | { name: 'index', href: '/', label: 'Open your folders for classic courses' }

export type AdaptiveLearnPublicStatus =
  | { kind: 'allowed', capabilities: { entry: true, read: true, write: true, jobAdmission: true } }
  | { kind: 'denied', capabilities: { entry: false, read: false, write: false, jobAdmission: false }, fallbackRoute: AdaptiveLearnFallbackRoute }

// AD-15 permits only the existing V2 scoring orchestration behind an adaptive
// wrapper. A standalone adaptive provider/job surface remains deferred.
export const ADAPTIVE_PROVIDER_ACTIONS = 'v2_wrapped_only_standalone_deferred' as const
export const ADAPTIVE_EXTERNAL_OBJECT_CLEANUP = 'deferred_no_adaptive_objects' as const

async function fallbackRoute(ctx: QueryCtx | MutationCtx, tokenIdentifier?: string): Promise<AdaptiveLearnFallbackRoute> {
  return tokenIdentifier && await hasLearnV2Access(ctx, tokenIdentifier)
    ? { name: 'app-learn', href: '/app/learn?legacy=v2', label: 'Open V2 learning plans' }
    : { name: 'index', href: '/', label: 'Open your folders for classic courses' }
}

export async function hasAdaptiveExperienceAccess(ctx: QueryCtx | MutationCtx, tokenIdentifier: string): Promise<boolean> {
  if (!(await hasLearnV2Access(ctx, tokenIdentifier))) return false
  const user = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', tokenIdentifier)).unique()
  return user?.learnAdaptiveExperienceEntitlement?.enabled === true
}

export async function getAdaptiveLearnPublicStatus(ctx: QueryCtx | MutationCtx): Promise<AdaptiveLearnPublicStatus> {
  const identity = await ctx.auth.getUserIdentity()
  if (identity && await hasAdaptiveExperienceAccess(ctx, identity.tokenIdentifier)) {
    return { kind: 'allowed', capabilities: { entry: true, read: true, write: true, jobAdmission: true } }
  }
  return { kind: 'denied', capabilities: { entry: false, read: false, write: false, jobAdmission: false },
    fallbackRoute: await fallbackRoute(ctx, identity?.tokenIdentifier) }
}

async function requireAdaptiveAccess(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity || !(await hasAdaptiveExperienceAccess(ctx, identity.tokenIdentifier))) {
    throw new ConvexError({ code: 'adaptive_access_denied', message: 'Adaptive Learn access denied',
      fallbackRoute: await fallbackRoute(ctx, identity?.tokenIdentifier) })
  }
  return identity.tokenIdentifier
}

export const requireAdaptiveQueryAccess = async (ctx: QueryCtx) => await requireAdaptiveAccess(ctx)
export const requireAdaptiveMutationAccess = async (ctx: MutationCtx) => await requireAdaptiveAccess(ctx)
export const requireAdaptiveJobAdmission = async (ctx: MutationCtx) => await requireAdaptiveAccess(ctx)

// Actions cannot read Convex state directly. This is the one internal adapter
// used by adaptive orchestration to evaluate the canonical conjunctive gate.
export const checkAdaptiveJobAdmission = internalQuery({
  args: { tokenIdentifier: v.string() },
  handler: async (ctx, args) => ({ allowed: await hasAdaptiveExperienceAccess(ctx, args.tokenIdentifier) }),
})
