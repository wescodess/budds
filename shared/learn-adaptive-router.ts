import type { AdaptiveActivityPrimitiveType } from './learn-adaptive-activity-registry'
import type { AdaptiveAvailableTime, AdaptiveEvidenceState, AdaptiveLearningIntent } from './learn-adaptive-activity-plan'
import { projectAdaptiveControls } from './learn-adaptive-controls'
import { deriveMasteryTransition, LEARN_V2_MASTERY_TRANSITION_VERSION, type MasteryState, type MasteryTransitionReason } from './learn-v2-mastery'

export const ADAPTIVE_ROUTER_VERSION = 'learn-adaptive.router.v1' as const
type RepresentativeAttemptKind = 'independent_application' | 'retained_transfer'

export type AdaptiveRouterInput = Readonly<{
  routerVersion: string
  threadState: string
  authorityKind: 'v2_mission' | 'standalone'
  intent: AdaptiveLearningIntent
  intentRevision: number
  sourceState: AdaptiveEvidenceState
  sourceInputs: ReadonlyArray<Readonly<{ sourceSnapshotId: string, effectiveStatus: 'user_accepted', recordRevision: number }>>
  pins: Readonly<{ learningVoidId: string | null, blueprintRevisionId: string | null, blueprintRecordRevision: number | null,
    objectiveId: string | null, sessionContentId: string | null, sessionContentRevision: number | null }>
  availableTime: AdaptiveAvailableTime
  priorActivity: null | Readonly<{ activityId: string, primitive: AdaptiveActivityPrimitiveType, activityClass: 'factual' | 'non_factual',
    outcome: 'completed' | 'representative_pass' | 'representative_fail' | 'incomplete' | 'provider_failure',
    attemptId: string | null, attemptKind: RepresentativeAttemptKind | null, assistance: 'none' | 'hint' | 'reveal', confidence: null | Readonly<{ scale: 'normalized_0_1' | 'v2_1_5', value: number }>,
    masteryTransition: null | Readonly<{ attemptId: string, attemptKind: RepresentativeAttemptKind, stateBefore: MasteryState, stateAfter: MasteryState,
      reason: MasteryTransitionReason, version: typeof LEARN_V2_MASTERY_TRANSITION_VERSION }> }>
  mastery: null | Readonly<{ scope: 'revision_scoped', blueprintRevisionId: string, objectiveId: string, state: MasteryState }>
}>

export type AdaptiveRouterReasonCode =
  | 'unsupported_input' | 'unsupported_router_version' | 'thread_unavailable' | 'unsupported_intent'
  | 'unsupported_pins' | 'unsupported_evidence' | 'unsupported_mastery' | 'unsupported_prior_activity'
  | 'evidence_blocked' | 'evidence_stale' | 'evidence_invalidated' | 'evidence_unavailable'
  | 'prior_activity_incomplete' | 'prior_provider_failure'
  | 'source_free_diagnostic' | 'preparing_diagnostic' | 'grounded_start' | 'representative_practice'
  | 'build_useful_artifact' | 'grounded_review' | 'compare_accepted_sources' | 'remediate_failed_attempt'
  | 'assisted_guidance' | 'reflect_on_demonstration' | 'low_confidence_support'

export type AdaptiveRouterResult = Readonly<{
  routerVersion: typeof ADAPTIVE_ROUTER_VERSION
  status: 'recommended' | 'blocked'
  recommendation: Readonly<{ primitive: AdaptiveActivityPrimitiveType, activityClass: 'factual' | 'non_factual' }> | null
  reasonCode: AdaptiveRouterReasonCode
  overrides: ReturnType<typeof projectAdaptiveControls>['options']
  fallback: Readonly<{ kind: 'non_factual_activity', primitive: 'diagnostic_prompt', activityClass: 'non_factual', reasonCode: 'safe_non_factual_recovery' }
    | { kind: 'safe_handoff', destination: 'learn_home', reasonCode: 'router_unavailable' }
    | { kind: 'stay_on_current', reasonCode: 'unresolved_prior_activity' }>
}>

const SAFE_FALLBACK = { kind: 'non_factual_activity' as const, primitive: 'diagnostic_prompt' as const, activityClass: 'non_factual' as const,
  reasonCode: 'safe_non_factual_recovery' as const }
const HANDOFF_FALLBACK = { kind: 'safe_handoff' as const, destination: 'learn_home' as const, reasonCode: 'router_unavailable' as const }
const CURRENT_FALLBACK = { kind: 'stay_on_current' as const, reasonCode: 'unresolved_prior_activity' as const }
const TOP_LEVEL_KEYS = ['routerVersion', 'threadState', 'authorityKind', 'intent', 'intentRevision', 'sourceState',
  'sourceInputs', 'pins', 'availableTime', 'priorActivity', 'mastery'] as const
const PIN_KEYS = ['learningVoidId', 'blueprintRevisionId', 'blueprintRecordRevision', 'objectiveId', 'sessionContentId', 'sessionContentRevision'] as const
const SOURCE_KEYS = ['sourceSnapshotId', 'effectiveStatus', 'recordRevision'] as const
const PRIOR_KEYS = ['activityId', 'primitive', 'activityClass', 'outcome', 'attemptId', 'attemptKind', 'assistance', 'confidence', 'masteryTransition'] as const
const TRANSITION_KEYS = ['attemptId', 'attemptKind', 'stateBefore', 'stateAfter', 'reason', 'version'] as const
const PRIMITIVES: readonly AdaptiveActivityPrimitiveType[] = ['cited_explanation', 'diagnostic_prompt', 'worked_example',
  'independent_application', 'source_comparison', 'artifact_workspace', 'reflection_next_move']
const INTENTS: readonly AdaptiveLearningIntent[] = ['understand', 'prepare', 'build', 'master', 'refresh', 'explore']
const MASTERY_STATES: readonly MasteryState[] = ['unseen', 'learning', 'guided', 'independent', 'retained', 'needs_review', 'blocked', 'provisionally_known']
const SOURCE_STATES: readonly AdaptiveEvidenceState[] = ['none', 'preparing', 'ready', 'blocked', 'stale', 'invalidated', 'unavailable']
const AVAILABLE_TIMES: readonly AdaptiveAvailableTime[] = ['15', '25', '45', '60', 'no_limit']
const EVIDENCE_BLOCKED_REASONS = { blocked: 'evidence_blocked', stale: 'evidence_stale',
  invalidated: 'evidence_invalidated', unavailable: 'evidence_unavailable' } as const

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function member<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function pinId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
}

function activityIdentity(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_:-]{1,200}$/.test(value)
}

function revision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
}

function invalidReason(input: unknown): AdaptiveRouterReasonCode | null {
  if (!exactKeys(input, TOP_LEVEL_KEYS)) return 'unsupported_input'
  if (input.routerVersion !== ADAPTIVE_ROUTER_VERSION) return 'unsupported_router_version'
  if (!member(input.threadState, ['ready', 'active'])) return 'thread_unavailable'
  if (!member(input.intent, INTENTS) || !revision(input.intentRevision)) return 'unsupported_intent'
  if (!member(input.availableTime, AVAILABLE_TIMES) || !member(input.sourceState, SOURCE_STATES)) return 'unsupported_input'
  if (!member(input.authorityKind, ['v2_mission', 'standalone'])) return 'unsupported_pins'
  if (!exactKeys(input.pins, PIN_KEYS)) return 'unsupported_pins'
  const pins = input.pins
  if (input.authorityKind === 'standalone' && PIN_KEYS.some(key => pins[key] !== null)) return 'unsupported_pins'
  if (input.authorityKind === 'v2_mission' && !pinId(pins.learningVoidId)) return 'unsupported_pins'
  if (['blueprintRevisionId', 'objectiveId', 'sessionContentId'].some(key => pins[key] !== null && !pinId(pins[key]))) return 'unsupported_pins'
  if (['blueprintRecordRevision', 'sessionContentRevision'].some(key => pins[key] !== null && !revision(pins[key]))) return 'unsupported_pins'
  if (!Array.isArray(input.sourceInputs) || input.sourceInputs.length > 16) return 'unsupported_evidence'
  let previousSourceId = ''
  for (const source of input.sourceInputs) {
    if (!exactKeys(source, SOURCE_KEYS) || !pinId(source.sourceSnapshotId) || source.sourceSnapshotId <= previousSourceId
      || source.effectiveStatus !== 'user_accepted' || !revision(source.recordRevision)) return 'unsupported_evidence'
    previousSourceId = source.sourceSnapshotId
  }
  if (input.sourceState === 'ready') {
    if (input.authorityKind !== 'v2_mission' || !pinId(pins.blueprintRevisionId) || !revision(pins.blueprintRecordRevision)
      || !pinId(pins.objectiveId) || !pinId(pins.sessionContentId) || !revision(pins.sessionContentRevision)) return 'unsupported_pins'
    if (input.sourceInputs.length === 0) return 'unsupported_evidence'
  }
  else if ((input.sourceState === 'none' || input.sourceState === 'preparing') && input.sourceInputs.length > 0) return 'unsupported_evidence'
  if (input.mastery !== null) {
    if (!exactKeys(input.mastery, ['scope', 'blueprintRevisionId', 'objectiveId', 'state']) || input.mastery.scope !== 'revision_scoped'
      || !pinId(input.mastery.blueprintRevisionId) || !pinId(input.mastery.objectiveId)
      || !member(input.mastery.state, MASTERY_STATES)) return 'unsupported_mastery'
    if (input.authorityKind !== 'v2_mission' || !pinId(pins.blueprintRevisionId) || !revision(pins.blueprintRecordRevision)
      || !pinId(pins.objectiveId) || input.mastery.blueprintRevisionId !== pins.blueprintRevisionId
      || input.mastery.objectiveId !== pins.objectiveId) return 'unsupported_mastery'
  }
  if (input.intent === 'master' && input.sourceState === 'ready' && input.mastery === null) return 'unsupported_mastery'
  if (input.sourceState === 'ready' && input.mastery?.state === 'blocked') return 'unsupported_mastery'
  if (input.priorActivity !== null) {
    if (!exactKeys(input.priorActivity, PRIOR_KEYS)) return 'unsupported_prior_activity'
    const prior = input.priorActivity
    if (!activityIdentity(prior.activityId) || !member(prior.primitive, PRIMITIVES)
      || !member(prior.activityClass, ['factual', 'non_factual'])
      || !member(prior.outcome, ['completed', 'representative_pass', 'representative_fail', 'incomplete', 'provider_failure'])
      || !member(prior.assistance, ['none', 'hint', 'reveal'])) return 'unsupported_prior_activity'
    if (['diagnostic_prompt', 'artifact_workspace', 'reflection_next_move'].includes(prior.primitive) && prior.activityClass !== 'non_factual'
      || ['cited_explanation', 'worked_example', 'independent_application', 'source_comparison'].includes(prior.primitive)
      && prior.activityClass !== 'factual') return 'unsupported_prior_activity'
    const representative = prior.outcome === 'representative_pass' || prior.outcome === 'representative_fail'
    if (representative !== (prior.attemptId !== null) || representative !== (prior.attemptKind !== null)
      || representative && (prior.primitive !== 'independent_application' || !pinId(prior.attemptId)
        || !member(prior.attemptKind, ['independent_application', 'retained_transfer']))) return 'unsupported_prior_activity'
    if (prior.primitive === 'independent_application' && prior.outcome === 'completed'
      || prior.activityClass === 'non_factual' && prior.outcome === 'provider_failure') return 'unsupported_prior_activity'
    if (representative) {
      const transition = prior.masteryTransition
      if (!exactKeys(transition, TRANSITION_KEYS) || transition.attemptId !== prior.attemptId
        || transition.attemptKind !== prior.attemptKind
        || !member(transition.stateBefore, MASTERY_STATES) || !member(transition.stateAfter, MASTERY_STATES)) return 'unsupported_prior_activity'
      if (prior.attemptKind === 'retained_transfer' && transition.stateBefore !== 'independent'
        && transition.stateBefore !== 'retained') return 'unsupported_mastery'
      const event = prior.attemptKind === 'retained_transfer'
        ? prior.assistance !== 'none' ? 'delayed_assisted' : prior.outcome === 'representative_fail' ? 'delayed_fail' : 'delayed_pass'
        : prior.outcome === 'representative_fail' ? 'independent_fail'
          : prior.assistance === 'none' ? 'independent_pass' : 'assisted_pass'
      const expected = deriveMasteryTransition(transition.stateBefore, event)
      if (transition.version !== LEARN_V2_MASTERY_TRANSITION_VERSION || transition.reason !== expected.reason
        || transition.stateAfter !== expected.state || !record(input.mastery) || input.mastery.state !== transition.stateAfter) return 'unsupported_mastery'
    }
    else if (prior.masteryTransition !== null) return 'unsupported_prior_activity'
    if (prior.confidence !== null) {
      if (!exactKeys(prior.confidence, ['scale', 'value']) || typeof prior.confidence.value !== 'number'
        || !Number.isFinite(prior.confidence.value)) return 'unsupported_prior_activity'
      if (prior.confidence.scale === 'normalized_0_1') {
        if (prior.confidence.value < 0 || prior.confidence.value > 1) return 'unsupported_prior_activity'
      }
      else if (prior.confidence.scale === 'v2_1_5') {
        if (!Number.isInteger(prior.confidence.value) || prior.confidence.value < 1 || prior.confidence.value > 5) return 'unsupported_prior_activity'
      }
      else return 'unsupported_prior_activity'
    }
  }
  return null
}

function controls(input: AdaptiveRouterInput, activityClass: 'factual' | 'non_factual', blocked: boolean) {
  return projectAdaptiveControls({ activityClass, activityStatus: blocked ? 'blocked' : 'eligible', lifecycle: 'active',
    evidenceReady: input.sourceState === 'ready', sourceCount: input.sourceInputs.length, currentTime: input.availableTime }).options
}

function normalizedConfidence(input: AdaptiveRouterInput) {
  const confidence = input.priorActivity?.confidence
  if (!confidence) return null
  return confidence.scale === 'v2_1_5' ? (confidence.value - 1) / 4 : confidence.value
}

function readyRecommendation(input: AdaptiveRouterInput): { primitive: AdaptiveActivityPrimitiveType, activityClass: 'factual' | 'non_factual', reasonCode: AdaptiveRouterReasonCode } {
  const prior = input.priorActivity
  if (prior?.outcome === 'representative_fail' || input.mastery?.state === 'needs_review') {
    return { primitive: 'worked_example', activityClass: 'factual', reasonCode: 'remediate_failed_attempt' }
  }
  if (prior?.assistance !== undefined && prior.assistance !== 'none') {
    return { primitive: 'worked_example', activityClass: 'factual', reasonCode: 'assisted_guidance' }
  }
  if (prior?.outcome === 'representative_pass' || input.mastery?.state === 'independent' || input.mastery?.state === 'retained') {
    return { primitive: 'reflection_next_move', activityClass: 'non_factual', reasonCode: 'reflect_on_demonstration' }
  }
  const confidence = normalizedConfidence(input)
  if (confidence !== null && confidence < 0.25) return { primitive: 'worked_example', activityClass: 'factual', reasonCode: 'low_confidence_support' }
  switch (input.intent) {
    case 'prepare':
    case 'master': return { primitive: 'independent_application', activityClass: 'factual', reasonCode: 'representative_practice' }
    case 'build': return { primitive: 'artifact_workspace', activityClass: 'non_factual', reasonCode: 'build_useful_artifact' }
    case 'refresh': return { primitive: 'cited_explanation', activityClass: 'factual', reasonCode: 'grounded_review' }
    case 'explore': return input.sourceInputs.length >= 2
      ? { primitive: 'source_comparison', activityClass: 'factual', reasonCode: 'compare_accepted_sources' }
      : { primitive: 'cited_explanation', activityClass: 'factual', reasonCode: 'grounded_start' }
    default: return { primitive: 'cited_explanation', activityClass: 'factual', reasonCode: 'grounded_start' }
  }
}

export function routeAdaptiveNextActivity(input: AdaptiveRouterInput): AdaptiveRouterResult {
  const invalid = invalidReason(input)
  if (invalid) return { routerVersion: ADAPTIVE_ROUTER_VERSION, status: 'blocked' as const,
    recommendation: null, reasonCode: invalid, overrides: [], fallback: { ...HANDOFF_FALLBACK } }
  if (input.sourceState === 'blocked' || input.sourceState === 'stale' || input.sourceState === 'invalidated' || input.sourceState === 'unavailable') {
    return { routerVersion: ADAPTIVE_ROUTER_VERSION, status: 'blocked' as const, recommendation: null,
      reasonCode: EVIDENCE_BLOCKED_REASONS[input.sourceState], overrides: controls(input, 'factual', true), fallback: { ...SAFE_FALLBACK } }
  }
  if (input.priorActivity?.outcome === 'incomplete' || input.priorActivity?.outcome === 'provider_failure') {
    return { routerVersion: ADAPTIVE_ROUTER_VERSION, status: 'blocked' as const, recommendation: null,
      reasonCode: input.priorActivity.outcome === 'incomplete' ? 'prior_activity_incomplete' as const : 'prior_provider_failure' as const,
      overrides: controls(input, input.priorActivity.activityClass, true), fallback: { ...CURRENT_FALLBACK } }
  }
  if (input.sourceState === 'none' || input.sourceState === 'preparing') {
    const recommendation = { primitive: 'diagnostic_prompt' as const, activityClass: 'non_factual' as const }
    return { routerVersion: ADAPTIVE_ROUTER_VERSION, status: 'recommended' as const, recommendation,
      reasonCode: input.sourceState === 'none' ? 'source_free_diagnostic' as const : 'preparing_diagnostic' as const,
      overrides: controls(input, recommendation.activityClass, false), fallback: { ...SAFE_FALLBACK } }
  }
  const { reasonCode, ...recommendation } = readyRecommendation(input)
  return {
    routerVersion: ADAPTIVE_ROUTER_VERSION,
    status: 'recommended' as const,
    recommendation,
    reasonCode,
    overrides: projectAdaptiveControls({ activityClass: recommendation.activityClass, activityStatus: 'eligible', lifecycle: 'active',
      evidenceReady: true, sourceCount: input.sourceInputs.length, currentTime: input.availableTime }).options,
    fallback: { ...SAFE_FALLBACK },
  }
}
