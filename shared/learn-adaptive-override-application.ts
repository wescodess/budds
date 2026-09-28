import type { AdaptiveOverrideOption, AdaptiveAvailableTime } from './learn-adaptive-controls'
import type { AdaptiveRouterInput, AdaptiveRouterResult } from './learn-adaptive-router'

export const ADAPTIVE_OVERRIDE_APPLICATION_VERSION = 'learn-adaptive.override-application.v1' as const

export type AdaptiveOverrideApplicationReason = 'applied' | 'router_blocked' | 'evidence_unavailable' | 'insufficient_sources' | 'policy_unavailable' | 'plan_invalid'
export type AdaptiveOverrideApplication = Readonly<{
  version: typeof ADAPTIVE_OVERRIDE_APPLICATION_VERSION
  option: AdaptiveOverrideOption
  outcome: 'applied' | 'fallback'
  applicationReason: AdaptiveOverrideApplicationReason
  status: AdaptiveRouterResult['status']
  recommendation: AdaptiveRouterResult['recommendation']
  reasonCode: AdaptiveRouterResult['reasonCode'] | `learner_requested_${AdaptiveOverrideOption}` | 'override_evidence_unavailable' | 'override_insufficient_sources' | 'override_policy_unavailable' | 'override_plan_invalid'
  fallback: AdaptiveRouterResult['fallback']
  effectiveAvailableTime: AdaptiveAvailableTime
}>

export function applyAdaptiveOverrideAtBoundary(
  input: AdaptiveRouterInput,
  routed: AdaptiveRouterResult,
  option: AdaptiveOverrideOption,
  planValid = true,
): AdaptiveOverrideApplication {
  const fallback = (applicationReason: Exclude<AdaptiveOverrideApplicationReason, 'applied'>,
    reasonCode: AdaptiveOverrideApplication['reasonCode']): AdaptiveOverrideApplication => ({
    version: ADAPTIVE_OVERRIDE_APPLICATION_VERSION, option, outcome: 'fallback', applicationReason,
    status: 'blocked', recommendation: null, reasonCode, fallback: routed.fallback,
    effectiveAvailableTime: input.availableTime,
  })
  if (!planValid) return fallback('plan_invalid', 'override_plan_invalid')
  if (routed.status === 'blocked' || !routed.recommendation) return fallback('router_blocked', routed.reasonCode)
  if (option === 'harder') return fallback('policy_unavailable', 'override_policy_unavailable')
  if (option === 'compare_sources' && input.sourceInputs.length < 2)
    return fallback('insufficient_sources', 'override_insufficient_sources')
  const sourceFree = input.sourceState === 'none' || input.sourceState === 'preparing'
  if (sourceFree && !['try', 'easier', 'time_15', 'time_25', 'time_45', 'time_60', 'time_no_limit'].includes(option))
    return fallback('evidence_unavailable', 'override_evidence_unavailable')
  if (!sourceFree && input.sourceState !== 'ready') return fallback('evidence_unavailable', 'override_evidence_unavailable')

  let recommendation: AdaptiveRouterResult['recommendation']
  let effectiveAvailableTime: AdaptiveAvailableTime = input.availableTime
  switch (option) {
    case 'explain_differently':
    case 'answer_now': recommendation = { primitive: 'cited_explanation', activityClass: 'factual' }; break
    case 'example': recommendation = { primitive: 'worked_example', activityClass: 'factual' }; break
    case 'try': recommendation = sourceFree
      ? { primitive: 'diagnostic_prompt', activityClass: 'non_factual' }
      : { primitive: 'independent_application', activityClass: 'factual' }; break
    case 'quiz': recommendation = { primitive: 'independent_application', activityClass: 'factual' }; break
    case 'compare_sources': recommendation = { primitive: 'source_comparison', activityClass: 'factual' }; break
    case 'practical': recommendation = { primitive: 'artifact_workspace', activityClass: 'non_factual' }; break
    case 'easier': recommendation = sourceFree
      ? { primitive: 'diagnostic_prompt', activityClass: 'non_factual' }
      : { primitive: 'worked_example', activityClass: 'factual' }; break
    case 'time_15': effectiveAvailableTime = '15'; recommendation = routed.recommendation; break
    case 'time_25': effectiveAvailableTime = '25'; recommendation = routed.recommendation; break
    case 'time_45': effectiveAvailableTime = '45'; recommendation = routed.recommendation; break
    case 'time_60': effectiveAvailableTime = '60'; recommendation = routed.recommendation; break
    case 'time_no_limit': effectiveAvailableTime = 'no_limit'; recommendation = routed.recommendation; break
  }
  return { version: ADAPTIVE_OVERRIDE_APPLICATION_VERSION, option, outcome: 'applied', applicationReason: 'applied',
    status: 'recommended', recommendation, reasonCode: `learner_requested_${option}`,
    fallback: routed.fallback, effectiveAvailableTime }
}
