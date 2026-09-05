import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server'
import { internal } from '../_generated/api'
import { hasAccountDeletionTombstone } from './accountDeletionTombstone'

export async function getOptionalAuthUserId(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) return null
  const tombstoned = 'db' in ctx
    ? await hasAccountDeletionTombstone(ctx, identity.tokenIdentifier)
    : (await ctx.runQuery(internal.accountDeletion.getDeletionTombstone, {
        userId: identity.tokenIdentifier,
      })) !== null
  if (tombstoned) throw new Error('Account deletion is in progress')
  return identity.tokenIdentifier
}

export async function requireAuth(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const userId = await getOptionalAuthUserId(ctx)
  if (!userId) throw new Error('Unauthenticated')
  return userId
}
