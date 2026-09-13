import type { MutationCtx, QueryCtx } from '../_generated/server'
import { hasAccountDeletionTombstone } from './accountDeletionTombstone'

export type LearnV2PublicStatus =
  | {
    kind: 'allowed'
    capabilities: {
      entry: true
      read: true
      write: true
      jobAdmission: true
    }
  }
  | {
    kind: 'denied'
    capabilities: {
      entry: false
      read: false
      write: false
      jobAdmission: false
    }
  }

type AuthenticatedContext = QueryCtx | MutationCtx

function allowed(): LearnV2PublicStatus {
  return {
    kind: 'allowed',
    capabilities: { entry: true, read: true, write: true, jobAdmission: true },
  }
}

function denied(): LearnV2PublicStatus {
  return {
    kind: 'denied',
    capabilities: { entry: false, read: false, write: false, jobAdmission: false },
  }
}

export async function hasLearnV2Access(
  ctx: QueryCtx | MutationCtx,
  tokenIdentifier: string,
): Promise<boolean> {
  // Deliberately read for every decision so a true -> false rollback takes
  // effect without a warm-runtime cache window.
  if (process.env.LEARN_V2_ENABLED !== 'true') return false
  if (await hasAccountDeletionTombstone(ctx, tokenIdentifier)) return false

  const user = await ctx.db
    .query('users')
    .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', tokenIdentifier))
    .unique()
  return user?.learnV2Entitlement?.enabled === true
}

export async function getLearnV2PublicStatus(
  ctx: AuthenticatedContext,
): Promise<LearnV2PublicStatus> {
  // Authentication is evaluated first so anonymous callers cannot distinguish
  // rollout states.
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) return denied()
  return await hasLearnV2Access(ctx, identity.tokenIdentifier) ? allowed() : denied()
}

async function requireLearnV2AuthenticatedAccess(ctx: AuthenticatedContext): Promise<string> {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity || !(await hasLearnV2Access(ctx, identity.tokenIdentifier))) {
    throw new Error('Learn V2 access denied')
  }
  return identity.tokenIdentifier
}

export async function requireLearnV2QueryAccess(ctx: QueryCtx): Promise<string> {
  return await requireLearnV2AuthenticatedAccess(ctx)
}

export async function requireLearnV2MutationAccess(ctx: MutationCtx): Promise<string> {
  return await requireLearnV2AuthenticatedAccess(ctx)
}
