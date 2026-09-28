import { v, type Infer } from 'convex/values'

export const ADAPTIVE_REASON_TEXT_VERSION = 'learn-adaptive.reason-text.v1' as const
export const ADAPTIVE_OVERRIDE_VERSION = 'learn-adaptive.override.v1' as const
export const ADAPTIVE_FIXED_NEXT_PLAN_VERSION = 'learn-adaptive.fixed-next-plan.v1' as const
export const ADAPTIVE_OVERRIDE_OPTIONS = [
  ['explain_differently', 'Explain differently'], ['example', 'Show an example'], ['try', 'Let me try'],
  ['quiz', 'Quiz me'], ['compare_sources', 'Compare sources'], ['practical', 'Make it practical'],
  ['easier', 'Make it easier'], ['harder', 'Make it harder'], ['answer_now', 'Answer now'],
  ['time_15', '15 minutes'], ['time_25', '25 minutes'], ['time_45', '45 minutes'],
  ['time_60', '60 minutes'], ['time_no_limit', 'No time limit'],
] as const
export type AdaptiveOverrideOption = typeof ADAPTIVE_OVERRIDE_OPTIONS[number][0]
export const adaptiveOverrideOptionValidator = v.union(
  v.literal('explain_differently'), v.literal('example'), v.literal('try'), v.literal('quiz'),
  v.literal('compare_sources'), v.literal('practical'), v.literal('easier'), v.literal('harder'),
  v.literal('answer_now'), v.literal('time_15'), v.literal('time_25'), v.literal('time_45'),
  v.literal('time_60'), v.literal('time_no_limit'),
)

export const adaptiveAvailableTimeValidator = v.union(v.literal('15'), v.literal('25'), v.literal('45'), v.literal('60'), v.literal('no_limit'))
export type AdaptiveAvailableTime = '15' | '25' | '45' | '60' | 'no_limit'
const nextActivityByOption = {
  explain_differently: 'alternate_explanation', example: 'worked_example', try: 'independent_try',
  quiz: 'knowledge_check', compare_sources: 'source_comparison', practical: 'practical_application',
  easier: 'guided_step', harder: 'challenge_step', answer_now: 'answer_step',
  time_15: 'continue_with_time', time_25: 'continue_with_time', time_45: 'continue_with_time',
  time_60: 'continue_with_time', time_no_limit: 'continue_with_time',
} as const satisfies Record<AdaptiveOverrideOption, string>
export const adaptiveFixedNextPlanValidator = v.object({
  version: v.literal(ADAPTIVE_FIXED_NEXT_PLAN_VERSION), inputOption: adaptiveOverrideOptionValidator,
  nextActivity: v.union(v.literal('alternate_explanation'), v.literal('worked_example'), v.literal('independent_try'),
    v.literal('knowledge_check'), v.literal('source_comparison'), v.literal('practical_application'),
    v.literal('guided_step'), v.literal('challenge_step'), v.literal('answer_step'), v.literal('continue_with_time')),
  availableTime: adaptiveAvailableTimeValidator,
  difficulty: v.union(v.literal('same'), v.literal('easier'), v.literal('harder')),
  maxNewActivities: v.literal(1), authority: v.literal('server_revalidate_at_boundary'),
})
export type AdaptiveFixedNextPlan = Infer<typeof adaptiveFixedNextPlanValidator>

export function fixedNextPlanForOverride(option: AdaptiveOverrideOption, currentTime: AdaptiveAvailableTime) {
  const availableTime = option === 'time_15' ? '15' : option === 'time_25' ? '25'
    : option === 'time_45' ? '45' : option === 'time_60' ? '60'
      : option === 'time_no_limit' ? 'no_limit' : currentTime
  return { version: ADAPTIVE_FIXED_NEXT_PLAN_VERSION, inputOption: option, nextActivity: nextActivityByOption[option],
    availableTime, difficulty: option === 'easier' ? 'easier' as const : option === 'harder' ? 'harder' as const : 'same' as const,
    maxNewActivities: 1 as const, authority: 'server_revalidate_at_boundary' as const }
}

export function reasonTextForActivity(input: { activityClass: 'factual' | 'non_factual', purpose: string, reasonCode: string, sourceState: string }) {
  const purpose = Array.from(input.purpose.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, 160).join('') || 'Current learning activity.'
  const text = input.reasonCode === 'ready_v2_session' && input.activityClass === 'factual'
    ? 'This activity uses accepted sources for the current learning objective.'
    : input.reasonCode === 'evidence_preparing_diagnostic' && input.activityClass === 'non_factual' && input.sourceState === 'preparing'
      ? 'This non-factual starting point was selected while the source was preparing.'
      : input.reasonCode === 'standalone_diagnostic' && input.activityClass === 'non_factual' && input.sourceState === 'none'
        ? 'No source was selected, so this non-factual starting point does not make factual claims.'
        : 'The specific selection reason is unavailable for this activity.'
  return { version: ADAPTIVE_REASON_TEXT_VERSION, purpose, text }
}

export function projectAdaptiveControls(input: {
  activityClass: 'factual' | 'non_factual'
  activityStatus: string
  lifecycle: string
  evidenceReady: boolean
  sourceCount: number
  currentTime: string
  purpose?: string
  reasonCode?: string
  sourceState?: string
  selected?: AdaptiveOverrideOption | null
  fixedNextPlan?: AdaptiveFixedNextPlan | null
  reasonText?: ReturnType<typeof reasonTextForActivity>
}) {
  const stateReady = !['ended', 'rollback', 'paused', 'blocked'].includes(input.lifecycle)
    && ['eligible', 'started'].includes(input.activityStatus)
  return {
    reasonText: input.reasonText ?? reasonTextForActivity({ activityClass: input.activityClass,
      purpose: input.purpose ?? 'Current learning activity.', reasonCode: input.reasonCode ?? '', sourceState: input.sourceState ?? 'none' }),
    selected: input.selected ?? null,
    fixedNextPlan: input.fixedNextPlan ?? null,
    options: ADAPTIVE_OVERRIDE_OPTIONS.map(([key, label]) => {
      let unavailableReason: 'state' | 'evidence' | 'mastery' | 'policy' | null = null
      if (!stateReady || key === 'answer_now' && input.activityStatus !== 'started') unavailableReason = 'state'
      else if (key === 'compare_sources' && (!input.evidenceReady || input.sourceCount < 2)
        || ['explain_differently', 'example'].includes(key) && !input.evidenceReady) unavailableReason = 'evidence'
      else if (key === 'harder') unavailableReason = 'policy'
      else if (['quiz', 'practical'].includes(key) && input.activityClass !== 'factual') unavailableReason = 'policy'
      else if (key === 'time_no_limit' && input.currentTime === 'no_limit') unavailableReason = 'policy'
      return { key, label, available: unavailableReason === null, unavailableReason }
    }),
  }
}
