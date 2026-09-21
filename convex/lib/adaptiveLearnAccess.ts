import { internalQuery, type MutationCtx, type QueryCtx } from '../_generated/server'
import { v } from 'convex/values'
import { hasLearnV2Access } from './learnV2Access'

export type AdaptiveLearnPublicStatus = {
  kind: 'allowed' | 'denied'
  capabilities: { entry: boolean, read: boolean, write: boolean, jobAdmission: boolean }
}

// AD-15 permits only the existing V2 scoring orchestration behind an adaptive
// wrapper. A standalone adaptive provider/job surface remains deferred.
export const ADAPTIVE_PROVIDER_ACTIONS = 'v2_wrapped_only_standalone_deferred' as const
export const ADAPTIVE_EXTERNAL_OBJECT_CLEANUP = 'deferred_no_adaptive_objects' as const

const status = (allowed: boolean): AdaptiveLearnPublicStatus => ({
  kind: allowed ? 'allowed' : 'denied',
  capabilities: { entry: allowed, read: allowed, write: allowed, jobAdmission: allowed },
})

export async function hasAdaptiveExperienceAccess(ctx: QueryCtx | MutationCtx, tokenIdentifier: string): Promise<boolean> {
  if (!(await hasLearnV2Access(ctx, tokenIdentifier))) return false
  const user = await ctx.db.query('users').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', tokenIdentifier)).unique()
  return user?.learnAdaptiveExperienceEntitlement?.enabled === true
}

export async function getAdaptiveLearnPublicStatus(ctx: QueryCtx | MutationCtx): Promise<AdaptiveLearnPublicStatus> {
  const identity = await ctx.auth.getUserIdentity()
  return status(Boolean(identity && await hasAdaptiveExperienceAccess(ctx, identity.tokenIdentifier)))
}

async function requireAdaptiveAccess(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity || !(await hasAdaptiveExperienceAccess(ctx, identity.tokenIdentifier))) throw new Error('Adaptive Learn access denied')
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
