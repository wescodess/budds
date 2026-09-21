import { v } from 'convex/values'

export const LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION = 'learn-adaptive.activity-events.v1' as const
export const LEARN_ACTIVITY_EVENT_TAXONOMY = [
  'thread_command_committed', 'meaningful_activity_started', 'thread_drafted', 'evidence_ready', 'evidence_blocked',
  'activity_eligible', 'activity_started', 'meaningful_response', 'assistance', 'activity_completed',
  'representative_pass', 'representative_fail', 'delayed_check_eligible', 'delayed_check_attempt', 'retained',
  'remediation', 'provider_failure', 'provider_ambiguity', 'evidence_gap', 'evidence_invalidation', 'abandonment', 'explicit_end',
] as const

export type LearnActivityEventType = typeof LEARN_ACTIVITY_EVENT_TAXONOMY[number]
export type LearnActivityEventVersion = `${LearnActivityEventType}.v1`
export type FirstValueEligibility = 'ready_factual_content' | 'ready_standalone_non_factual' | 'preparing' | 'excluded'
export type FirstValueExclusionCode = 'explicit_exclusion' | 'not_authenticated' | 'flag_ineligible' | 'evidence_blocked_at_commit' | 'content_not_published_at_commit' | 'standalone_activity_invalid'

export const learnActivityEventTypeValidator = v.union(...LEARN_ACTIVITY_EVENT_TAXONOMY.map(type => v.literal(type)) as [ReturnType<typeof v.literal>, ReturnType<typeof v.literal>, ...Array<ReturnType<typeof v.literal>>])
export const learnActivityEventVersionValidator = v.union(...LEARN_ACTIVITY_EVENT_TAXONOMY.map(type => v.literal(`${type}.v1`)) as [ReturnType<typeof v.literal>, ReturnType<typeof v.literal>, ...Array<ReturnType<typeof v.literal>>])
export const firstValueEligibilityValidator = v.union(v.literal('ready_factual_content'), v.literal('ready_standalone_non_factual'), v.literal('preparing'), v.literal('excluded'))
export const firstValueExclusionCodeValidator = v.union(v.literal('explicit_exclusion'), v.literal('not_authenticated'), v.literal('flag_ineligible'), v.literal('evidence_blocked_at_commit'), v.literal('content_not_published_at_commit'), v.literal('standalone_activity_invalid'))

export const learnActivityEventMetadataValidator = v.object({
  activityClass: v.optional(v.union(v.literal('factual'), v.literal('non_factual'))),
  boundaryOrdinal: v.optional(v.number()),
  planRevision: v.optional(v.number()),
  opportunityOrdinal: v.optional(v.number()),
  assistanceLevel: v.optional(v.union(v.literal('none'), v.literal('hint'), v.literal('reveal'))),
  attemptKind: v.optional(v.union(v.literal('independent_application'), v.literal('retained_transfer'))),
  masteryState: v.optional(v.union(v.literal('unseen'), v.literal('learning'), v.literal('guided'), v.literal('independent'), v.literal('retained'), v.literal('needs_review'), v.literal('blocked'), v.literal('provisionally_known'))),
  providerStage: v.optional(v.union(v.literal('reservation'), v.literal('dispatch'), v.literal('outcome'), v.literal('reconciliation'))),
  firstValueEligibility: v.optional(firstValueEligibilityValidator),
  firstValueExclusionCode: v.optional(firstValueExclusionCodeValidator),
  cohort: v.optional(v.string()),
})

export const learnActivityEventFields = {
  userId: v.string(),
  threadId: v.id('learningThreads'),
  activityId: v.optional(v.id('learningThreadActivities')),
  eventType: learnActivityEventTypeValidator,
  eventVersion: learnActivityEventVersionValidator,
  taxonomyVersion: v.literal(LEARN_ACTIVITY_EVENT_TAXONOMY_VERSION),
  occurredAt: v.number(),
  reasonCode: v.optional(v.string()),
  outcomeCode: v.optional(v.string()),
  sourceVersion: v.string(),
  contractVersion: v.string(),
  metricDefinitionVersion: v.optional(v.literal('first_value.v1')),
  metadata: learnActivityEventMetadataValidator,
  dedupeKeyHash: v.string(),
}

export type LearnActivityEventMetadata = {
  activityClass?: 'factual' | 'non_factual'
  boundaryOrdinal?: number
  planRevision?: number
  opportunityOrdinal?: number
  assistanceLevel?: 'none' | 'hint' | 'reveal'
  attemptKind?: 'independent_application' | 'retained_transfer'
  masteryState?: 'unseen' | 'learning' | 'guided' | 'independent' | 'retained' | 'needs_review' | 'blocked' | 'provisionally_known'
  providerStage?: 'reservation' | 'dispatch' | 'outcome' | 'reconciliation'
  firstValueEligibility?: FirstValueEligibility
  firstValueExclusionCode?: FirstValueExclusionCode
  cohort?: string
}

export type LearnActivityEventInput = {
  eventType: LearnActivityEventType
  eventVersion: LearnActivityEventVersion
  sourceVersion: string
  contractVersion: string
  metricDefinitionVersion?: 'first_value.v1'
  semanticKey: string
  occurredAt: number
  reasonCode?: string
  outcomeCode?: string
  metadata?: LearnActivityEventMetadata
}

const INPUT_KEYS = new Set(['eventType', 'eventVersion', 'sourceVersion', 'contractVersion', 'metricDefinitionVersion', 'semanticKey', 'occurredAt', 'reasonCode', 'outcomeCode', 'metadata'])
const METADATA_KEYS = new Set(['activityClass', 'boundaryOrdinal', 'planRevision', 'opportunityOrdinal', 'assistanceLevel', 'attemptKind', 'masteryState', 'providerStage', 'firstValueEligibility', 'firstValueExclusionCode', 'cohort'])
const CODE = /^[a-z0-9][a-z0-9_:-]{0,95}$/
const VERSION = /^[a-z0-9][a-z0-9._:-]{0,127}$/
const SEMANTIC_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/

export function eventVersionFor<T extends LearnActivityEventType>(eventType: T): `${T}.v1` {
  return `${eventType}.v1`
}

export function validateLearnActivityEventInput<T extends LearnActivityEventInput>(input: T): T {
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !INPUT_KEYS.has(key))) throw new Error('Adaptive event payload contains unsupported fields')
  if (!LEARN_ACTIVITY_EVENT_TAXONOMY.includes(input.eventType) || input.eventVersion !== eventVersionFor(input.eventType)) throw new Error('Adaptive event type/version pairing is invalid')
  if (!VERSION.test(input.sourceVersion) || !VERSION.test(input.contractVersion)) throw new Error('Adaptive event source or contract version is invalid')
  if (!SEMANTIC_KEY.test(input.semanticKey)) throw new Error('Adaptive event semantic key is invalid')
  if (!Number.isSafeInteger(input.occurredAt) || input.occurredAt < 0) throw new Error('Adaptive event time is invalid')
  if (input.reasonCode !== undefined && !CODE.test(input.reasonCode)) throw new Error('Adaptive event reason code is invalid')
  if (input.outcomeCode !== undefined && !CODE.test(input.outcomeCode)) throw new Error('Adaptive event outcome code is invalid')
  const metadata = input.metadata ?? {}
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || Object.keys(metadata).some(key => !METADATA_KEYS.has(key))) throw new Error('Adaptive event metadata contains unsupported fields')
  for (const field of ['boundaryOrdinal', 'planRevision', 'opportunityOrdinal'] as const) {
    const value = metadata[field]
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new Error('Adaptive event metadata number is invalid')
  }
  if (metadata.cohort !== undefined && !CODE.test(metadata.cohort)) throw new Error('Adaptive event cohort is invalid')
  if (metadata.firstValueExclusionCode !== undefined && metadata.firstValueEligibility !== 'excluded') throw new Error('Adaptive event first-value exclusion is invalid')
  if (input.eventType === 'thread_command_committed' && (input.metricDefinitionVersion !== 'first_value.v1' || metadata.opportunityOrdinal === undefined || metadata.firstValueEligibility === undefined || metadata.cohort === undefined)) throw new Error('Adaptive first-value opportunity metadata is invalid')
  if (input.eventType === 'meaningful_activity_started' && (input.metricDefinitionVersion !== 'first_value.v1' || metadata.opportunityOrdinal === undefined)) throw new Error('Adaptive first-value stop metadata is invalid')
  return input
}
