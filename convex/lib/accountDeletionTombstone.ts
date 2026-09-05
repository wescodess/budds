import type { MutationCtx, QueryCtx } from '../_generated/server'

/**
 * Account deletion is intentionally asynchronous. This durable tombstone is
 * the authority boundary while the user's data is being removed in batches.
 */
export async function isAccountDeletionActive(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<boolean> {
  const job = await ctx.db
    .query('accountDeletionJobs')
    .withIndex('by_userId', q => q.eq('userId', userId))
    .unique()
  return job?.status === 'active'
}

/** A completed deletion remains a permanent guard against stale JWT replay. */
export async function hasAccountDeletionTombstone(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<boolean> {
  return (await ctx.db
    .query('accountDeletionJobs')
    .withIndex('by_userId', q => q.eq('userId', userId))
    .unique()) !== null
}

export async function rejectAccountDeletion(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<void> {
  if (await hasAccountDeletionTombstone(ctx, userId)) {
    throw new Error('Account deletion is in progress')
  }
}
