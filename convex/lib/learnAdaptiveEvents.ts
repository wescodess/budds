import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import {
  LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION,
  validateLearnActivityEventInput,
  type LearnActivityEventInput,
} from '../../shared/learn-adaptive-events'
import { canonicalAdaptiveActivityJson } from '../../shared/learn-adaptive-activity-plan'

type WriteEventInput = LearnActivityEventInput & {
  userId: string
  threadId: Id<'learningThreads'>
  activityId?: Id<'learningThreadActivities'>
}

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return `sha256:${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function writeLearnActivityEvent(ctx: MutationCtx, input: WriteEventInput) {
  const { userId, threadId, activityId, ...candidate } = input
  const event = validateLearnActivityEventInput(candidate)
  const thread = await ctx.db.get(threadId)
  if (!thread || thread.userId !== userId) throw new Error('Adaptive event authority is unavailable')
  if (activityId) {
    const activity = await ctx.db.get(activityId)
    if (!activity || activity.userId !== userId || activity.threadId !== threadId) throw new Error('Adaptive event activity authority is unavailable')
  }
  const dedupeKeyHash = await digest(JSON.stringify([LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, userId, String(threadId), event.eventVersion, event.semanticKey]))
  const prior = await ctx.db.query('learnActivityEvents')
    .withIndex('by_userId_and_dedupeKeyHash', q => q.eq('userId', userId).eq('dedupeKeyHash', dedupeKeyHash))
    .unique()
  if (prior) {
    const same = prior.threadId === threadId
      && prior.activityId === activityId
      && prior.eventType === event.eventType
      && prior.eventVersion === event.eventVersion
      && prior.sourceVersion === event.sourceVersion
      && prior.contractVersion === event.contractVersion
      && prior.metricDefinitionVersion === event.metricDefinitionVersion
      && prior.reasonCode === event.reasonCode
      && prior.outcomeCode === event.outcomeCode
      && canonicalAdaptiveActivityJson(prior.metadata) === canonicalAdaptiveActivityJson(event.metadata ?? {})
    if (!same) throw new Error('Adaptive event semantic key conflicts with the authoritative event')
    return { eventId: prior._id, replayed: true as const }
  }
  const eventId = await ctx.db.insert('learnActivityEvents', {
    userId,
    threadId,
    ...(activityId ? { activityId } : {}),
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    taxonomyVersion: LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION,
    occurredAt: event.occurredAt,
    reasonCode: event.reasonCode,
    outcomeCode: event.outcomeCode,
    sourceVersion: event.sourceVersion,
    contractVersion: event.contractVersion,
    metricDefinitionVersion: event.metricDefinitionVersion,
    metadata: event.metadata ?? {},
    dedupeKeyHash,
  })
  return { eventId, replayed: false as const }
}

export async function findCurrentAdaptiveActivityForSessionContent(
  ctx: MutationCtx | QueryCtx,
  userId: string,
  sessionContentId: Id<'sessionContent'>,
  allowedStatuses?: ReadonlySet<Doc<'learningThreadActivities'>['status']>,
) {
  const candidates = await ctx.db.query('learningThreadActivities')
    .withIndex('by_userId_and_sessionContentId_and_updatedAt', q => q.eq('userId', userId).eq('sessionContentId', sessionContentId))
    .order('desc')
    .take(9)
  if (candidates.length > 8) return null
  const current: Array<{ activity: Doc<'learningThreadActivities'>, thread: Doc<'learningThreads'> }> = []
  for (const activity of candidates) {
    if (activity.status === 'ended' || activity.status === 'replaced' || (allowedStatuses && !allowedStatuses.has(activity.status))) continue
    const thread = await ctx.db.get(activity.threadId)
    if (thread?.userId === userId && thread.currentActivityId === activity._id && thread.deletionStartedAt === undefined) current.push({ activity, thread })
  }
  return current.length === 1 ? current[0] : null
}

export async function hasLearnActivityEvent(
  ctx: MutationCtx | QueryCtx,
  userId: string,
  activityId: Id<'learningThreadActivities'>,
  eventType: LearnActivityEventInput['eventType'],
) {
  return (await ctx.db.query('learnActivityEvents')
    .withIndex('by_userId_and_activityId_and_eventType_and_occurredAt', q => q.eq('userId', userId).eq('activityId', activityId).eq('eventType', eventType))
    .first()) !== null
}
