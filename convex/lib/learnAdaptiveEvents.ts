import type { Doc, Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import {
  LEGACY_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION,
  SECOND_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION,
  PREVIOUS_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION,
  FOURTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION,
  FIFTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION,
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

type EventTaxonomyVersion = typeof LEGACY_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION | typeof SECOND_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION | typeof PREVIOUS_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION | typeof FOURTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION | typeof FIFTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION | typeof LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION

export async function learnActivityEventDedupeHash(input: { userId: string, threadId: Id<'learningThreads'>, eventVersion: string, semanticKey: string, taxonomyVersion?: EventTaxonomyVersion }) {
  const taxonomyVersion = input.taxonomyVersion ?? LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION
  if (taxonomyVersion === LEGACY_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION && input.eventVersion === 'routing_decision.v1')
    throw new Error('Routing decisions are unavailable in the legacy event taxonomy')
  if (taxonomyVersion === LEGACY_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION || taxonomyVersion === SECOND_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION) {
    if (input.eventVersion === 'canvas_render_failure.v1') throw new Error('Canvas render failures are unavailable in an older event taxonomy')
  }
  if (taxonomyVersion !== FOURTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION && taxonomyVersion !== FIFTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION && taxonomyVersion !== LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION
    && (input.eventVersion === 'contribution_recorded.v1' || input.eventVersion === 'contribution_rejected.v1'))
    throw new Error('Contributions are unavailable in an older event taxonomy')
  if (taxonomyVersion !== LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION && taxonomyVersion !== FIFTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION && input.eventVersion.startsWith('cross_feature_activity_'))
    throw new Error('Cross-feature activity events are unavailable in an older event taxonomy')
  if (taxonomyVersion !== LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION && input.eventVersion === 'experiment_assignment.v1')
    throw new Error('Experiment assignments are unavailable in an older event taxonomy')
  return await digest(JSON.stringify([taxonomyVersion, input.userId, String(input.threadId), input.eventVersion, input.semanticKey]))
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
  const lookupVersions: EventTaxonomyVersion[] = event.eventType === 'experiment_assignment'
    ? [LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION]
    : event.eventType.startsWith('cross_feature_activity_')
    ? [LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, FIFTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION]
    : event.eventType === 'contribution_recorded' || event.eventType === 'contribution_rejected'
      ? [LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, FIFTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, FOURTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION]
    : event.eventType === 'canvas_render_failure'
      ? [LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, FIFTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, FOURTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, PREVIOUS_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION]
      : event.eventType === 'routing_decision'
        ? [LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, FIFTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, FOURTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, PREVIOUS_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, SECOND_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION]
        : [LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, FIFTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, FOURTH_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, PREVIOUS_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, SECOND_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION, LEGACY_LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION]
  const matches = [] as Doc<'learnActivityEvents'>[]
  for (const taxonomyVersion of lookupVersions) {
    const hash = await learnActivityEventDedupeHash({ userId, threadId, eventVersion: event.eventVersion,
      semanticKey: event.semanticKey, taxonomyVersion })
    const found = await ctx.db.query('learnActivityEvents')
      .withIndex('by_userId_and_dedupeKeyHash', q => q.eq('userId', userId).eq('dedupeKeyHash', hash))
      .unique()
    if (found) {
      if (found.taxonomyVersion !== taxonomyVersion) throw new Error('Adaptive event taxonomy/hash mismatch')
      matches.push(found)
    }
  }
  if (matches.length > 1) throw new Error('Adaptive event semantic key has duplicate taxonomy records')
  const prior = matches[0]
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
  const dedupeKeyHash = await learnActivityEventDedupeHash({ userId, threadId, eventVersion: event.eventVersion, semanticKey: event.semanticKey })
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
