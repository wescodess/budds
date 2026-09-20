import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'

type DatabaseCtx = MutationCtx | QueryCtx

export async function masteryScopeKey(
  userId: string,
  blueprintRevisionId: Id<'learnBlueprintRevisions'>,
  objectiveId: Id<'learnObjectives'>,
) {
  const canonical = JSON.stringify(['learn-v2-mastery-scope.v1', userId, String(blueprintRevisionId), String(objectiveId)])
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)))
  return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function getScopedMasteryRecord(
  ctx: DatabaseCtx,
  userId: string,
  blueprintRevisionId: Id<'learnBlueprintRevisions'>,
  objectiveId: Id<'learnObjectives'>,
) {
  const scopeKey = await masteryScopeKey(userId, blueprintRevisionId, objectiveId)
  const record = await ctx.db.query('masteryRecords')
    .withIndex('by_userId_and_scopeKey', q => q.eq('userId', userId).eq('scopeKey', scopeKey))
    .unique()
  if (record && (record.blueprintRevisionId !== blueprintRevisionId || record.objectiveId !== objectiveId || record.scopeKey !== scopeKey)) {
    throw new Error('Mastery scope identity is invalid')
  }
  return { record, scopeKey }
}

type MasteryTransition = Pick<Doc<'masteryRecords'>, 'state'> & Partial<Pick<Doc<'masteryRecords'>,
  'schedulingPriority' | 'recordRevision' | 'firstIndependentPassAt' | 'firstIndependentLocalDate' |
  'firstIndependentTimezone' | 'lastAttemptAt' | 'lastAttemptId' | 'remediationAttemptId' |
  'nextReviewAt' | 'updatedAt'>>

export async function transitionScopedMasteryRecord(
  ctx: MutationCtx,
  input: {
    userId: string
    blueprintRevisionId: Id<'learnBlueprintRevisions'>
    objectiveId: Id<'learnObjectives'>
    transition: MasteryTransition
  },
) {
  const { record, scopeKey } = await getScopedMasteryRecord(ctx, input.userId, input.blueprintRevisionId, input.objectiveId)
  const transition = { ...input.transition, recordRevision: (record?.recordRevision ?? 0) + 1 }
  if (record) {
    await ctx.db.patch(record._id, transition)
    return record._id
  }
  return await ctx.db.insert('masteryRecords', {
    userId: input.userId,
    blueprintRevisionId: input.blueprintRevisionId,
    objectiveId: input.objectiveId,
    scopeKey,
    ...transition,
  })
}
