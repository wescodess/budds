import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

type DatabaseCtx = MutationCtx | QueryCtx

export async function requireActiveBlueprint(
  ctx: DatabaseCtx,
  userId: string,
  learningVoid: Doc<'learningVoids'>,
  expectedBlueprintRevisionId?: Id<'learnBlueprintRevisions'>,
) {
  if (learningVoid.userId !== userId || !learningVoid.activeBlueprintRevisionId) {
    throw new Error('Active Blueprint pointer is unavailable')
  }
  const blueprint = await ctx.db.get(learningVoid.activeBlueprintRevisionId)
  if (!blueprint || blueprint.userId !== userId || blueprint.learningVoidId !== learningVoid._id || blueprint.status !== 'accepted') {
    throw new Error('Active Blueprint pointer is invalid')
  }
  if (expectedBlueprintRevisionId && blueprint._id !== expectedBlueprintRevisionId) {
    throw new Error('Active Blueprint pointer is stale')
  }
  return blueprint
}
