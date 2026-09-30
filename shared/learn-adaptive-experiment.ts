import { v, type Infer } from 'convex/values'

export const ADAPTIVE_ROUTING_ANALYSIS_VERSION = 'adaptive-routing-analysis.v1' as const
export const ADAPTIVE_ROUTING_ASSIGNMENT_CONTRACT_VERSION = 'learn-adaptive.experiment-assignment.v1' as const

export const adaptiveRoutingAnalysisPlanValidator = v.object({
  version: v.literal(ADAPTIVE_ROUTING_ANALYSIS_VERSION),
  fixedContinuationVersion: v.string(),
  primaryOutcomeVersion: v.string(),
  eligibilityVersion: v.string(),
  denominatorVersion: v.string(),
  baselineRate: v.number(),
  minimumEffectPercentagePoints: v.number(),
  minimumSamplePerArm: v.number(),
  stopAfterDays: v.number(),
  confidenceRule: v.string(),
  accessibilityCompletionVersion: v.string(),
  recoverySuccessVersion: v.string(),
  productAnalyticsOwner: v.string(),
  productApprover: v.string(),
  qaGuardrailVerifier: v.string(),
  engineeringReplayOwner: v.string(),
  guardrailMaxDegradationPercentagePoints: v.literal(3),
  rollbackTrigger: v.literal('strict_guardrail_drop_gt_3pp'),
  definitions: v.object({
    fixedContinuation: v.string(), primaryOutcome: v.string(), eligibility: v.string(),
    denominator: v.string(), baselineSource: v.string(), baselineWindow: v.string(),
    sampleStop: v.string(), confidenceMethod: v.string(),
    accessibilityCompletion: v.string(), recoverySuccess: v.string(), guardrailWindow: v.string(),
  }),
})

const CODE = /^[a-z0-9][a-z0-9._:-]{0,95}$/

export function validateAdaptiveRoutingAnalysisPlan(plan: Infer<typeof adaptiveRoutingAnalysisPlanValidator>) {
  for (const field of ['fixedContinuationVersion', 'primaryOutcomeVersion', 'eligibilityVersion', 'denominatorVersion',
    'accessibilityCompletionVersion', 'recoverySuccessVersion', 'productAnalyticsOwner', 'productApprover',
    'qaGuardrailVerifier', 'engineeringReplayOwner'] as const) {
    if (!CODE.test(plan[field])) throw new Error(`Adaptive routing analysis ${field} is invalid`)
  }
  if (Object.values(plan.definitions).some(value => value.trim().length < 1 || value.length > 512))
    throw new Error('Adaptive routing analysis definitions are incomplete')
  if (typeof plan.confidenceRule !== 'string' || plan.confidenceRule.length < 1 || plan.confidenceRule.length > 160)
    throw new Error('Adaptive routing analysis confidence rule is invalid')
  if (!Number.isFinite(plan.baselineRate) || plan.baselineRate < 0 || plan.baselineRate > 1
    || !Number.isFinite(plan.minimumEffectPercentagePoints) || plan.minimumEffectPercentagePoints <= 0 || plan.minimumEffectPercentagePoints > 100
    || !Number.isSafeInteger(plan.minimumSamplePerArm) || plan.minimumSamplePerArm < 1 || plan.minimumSamplePerArm > 1_000_000
    || !Number.isSafeInteger(plan.stopAfterDays) || plan.stopAfterDays < 1 || plan.stopAfterDays > 365)
    throw new Error('Adaptive routing analysis thresholds are invalid')
  return plan
}
