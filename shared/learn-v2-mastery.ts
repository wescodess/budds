import { v, type Infer } from 'convex/values'

export const LEARN_V2_MASTERY_SCORER_VERSION = 'learn-v2.mastery-scorer.v1'
export const LEARN_V2_MASTERY_THRESHOLD = 80
export const LEARN_V2_MASTERY_TRANSITION_VERSION = 'learn-v2.mastery-transition.v1'

export const masteryStateValidator = v.union(v.literal('unseen'), v.literal('learning'), v.literal('guided'), v.literal('independent'), v.literal('retained'), v.literal('needs_review'), v.literal('blocked'), v.literal('provisionally_known'))
export const masteryTransitionReasonValidator = v.union(v.literal('calibration_provisional'), v.literal('calibration_learning'), v.literal('calibration_mastery_preserved'), v.literal('assisted_pass_guided'), v.literal('assisted_mastery_preserved'), v.literal('unassisted_pass_independent'), v.literal('eligible_delayed_pass_retained'), v.literal('failed_check_needs_review'), v.literal('eligible_delayed_failure_needs_review'), v.literal('retained_mastery_preserved'))
export type MasteryState = Infer<typeof masteryStateValidator>
export type MasteryTransitionReason = Infer<typeof masteryTransitionReasonValidator>
export type MasteryClock = { now: () => number }
export type MasteryEvent = 'calibration_pass' | 'calibration_nonqualifying' | 'guided_pass' | 'guided_fail' | 'assisted_pass' | 'independent_pass' | 'independent_fail' | 'delayed_assisted' | 'delayed_pass' | 'delayed_fail'
type TransitionRule = { state: MasteryState, reason: MasteryTransitionReason, remediation: boolean }

const lowerStateRules = {
  calibration_pass: { state: 'provisionally_known', reason: 'calibration_provisional', remediation: false },
  calibration_nonqualifying: { state: 'learning', reason: 'calibration_learning', remediation: true },
  guided_pass: { state: 'guided', reason: 'assisted_pass_guided', remediation: false },
  guided_fail: { state: 'needs_review', reason: 'failed_check_needs_review', remediation: true },
  assisted_pass: { state: 'guided', reason: 'assisted_pass_guided', remediation: false },
  independent_pass: { state: 'independent', reason: 'unassisted_pass_independent', remediation: false },
  independent_fail: { state: 'needs_review', reason: 'failed_check_needs_review', remediation: true },
  delayed_assisted: { state: 'guided', reason: 'assisted_pass_guided', remediation: false },
  delayed_pass: { state: 'retained', reason: 'eligible_delayed_pass_retained', remediation: false },
  delayed_fail: { state: 'needs_review', reason: 'eligible_delayed_failure_needs_review', remediation: true },
} as const satisfies Record<MasteryEvent, TransitionRule>

const independentRules = {
  calibration_pass: { state: 'independent', reason: 'calibration_mastery_preserved', remediation: false },
  calibration_nonqualifying: { state: 'independent', reason: 'calibration_mastery_preserved', remediation: false },
  guided_pass: { state: 'independent', reason: 'assisted_mastery_preserved', remediation: false },
  guided_fail: { state: 'independent', reason: 'assisted_mastery_preserved', remediation: false },
  assisted_pass: { state: 'independent', reason: 'assisted_mastery_preserved', remediation: false },
  independent_pass: { state: 'independent', reason: 'unassisted_pass_independent', remediation: false },
  independent_fail: { state: 'needs_review', reason: 'failed_check_needs_review', remediation: true },
  delayed_assisted: { state: 'independent', reason: 'assisted_mastery_preserved', remediation: false },
  delayed_pass: { state: 'retained', reason: 'eligible_delayed_pass_retained', remediation: false },
  delayed_fail: { state: 'needs_review', reason: 'eligible_delayed_failure_needs_review', remediation: true },
} as const satisfies Record<MasteryEvent, TransitionRule>

const retainedRules = {
  calibration_pass: { state: 'retained', reason: 'calibration_mastery_preserved', remediation: false },
  calibration_nonqualifying: { state: 'retained', reason: 'calibration_mastery_preserved', remediation: false },
  guided_pass: { state: 'retained', reason: 'assisted_mastery_preserved', remediation: false },
  guided_fail: { state: 'retained', reason: 'assisted_mastery_preserved', remediation: false },
  assisted_pass: { state: 'retained', reason: 'assisted_mastery_preserved', remediation: false },
  independent_pass: { state: 'retained', reason: 'retained_mastery_preserved', remediation: false },
  independent_fail: { state: 'retained', reason: 'retained_mastery_preserved', remediation: false },
  delayed_assisted: { state: 'retained', reason: 'assisted_mastery_preserved', remediation: false },
  delayed_pass: { state: 'retained', reason: 'eligible_delayed_pass_retained', remediation: false },
  delayed_fail: { state: 'needs_review', reason: 'eligible_delayed_failure_needs_review', remediation: true },
} as const satisfies Record<MasteryEvent, TransitionRule>

function preserveCalibration(state: MasteryState, rules: typeof lowerStateRules): Record<MasteryEvent, TransitionRule> {
  return {
    ...rules,
    calibration_pass: { state, reason: 'calibration_mastery_preserved', remediation: false },
    calibration_nonqualifying: { state, reason: 'calibration_mastery_preserved', remediation: false },
  }
}

const guidedRules = preserveCalibration('guided', lowerStateRules)
const needsReviewRules = preserveCalibration('needs_review', lowerStateRules)
const blockedRules = preserveCalibration('blocked', lowerStateRules)
const provisionallyKnownRules = preserveCalibration('provisionally_known', lowerStateRules)

const MASTERY_TRANSITION_TABLE = {
  unseen: lowerStateRules,
  learning: lowerStateRules,
  guided: guidedRules,
  independent: independentRules,
  retained: retainedRules,
  needs_review: needsReviewRules,
  blocked: blockedRules,
  provisionally_known: provisionallyKnownRules,
} as const satisfies Record<MasteryState, Record<MasteryEvent, TransitionRule>>

export function deriveMasteryTransition(previousState: MasteryState, event: MasteryEvent, firstIndependentLocalDate?: string) {
  const rule = MASTERY_TRANSITION_TABLE[previousState][event]
  return {
    previousState,
    ...rule,
    setFirstIndependent: event === 'independent_pass' && rule.state === 'independent' && !firstIndependentLocalDate,
    transitionVersion: LEARN_V2_MASTERY_TRANSITION_VERSION as typeof LEARN_V2_MASTERY_TRANSITION_VERSION,
  }
}

export function localDateAt(utcMs: number, timeZone: string) {
  if (!Number.isFinite(utcMs)) throw new Error('Mastery clock returned an invalid instant')
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(utcMs)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function masteryAttemptTime(timeZone: string, clock: MasteryClock = { now: () => Date.now() }) {
  const attemptedAt = clock.now()
  return { attemptedAt, localDate: localDateAt(attemptedAt, timeZone) }
}

// Calendar arithmetic intentionally uses ISO dates, rather than 24-hour
// intervals, so the seven-day rule is stable through DST transitions.
export function addCalendarDays(localDate: string, days: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !Number.isSafeInteger(days)) throw new Error('Mastery local date is invalid')
  const [year, month, day] = localDate.split('-').map(Number)
  const value = new Date(Date.UTC(year!, month! - 1, day! + days))
  const source = new Date(Date.UTC(year!, month! - 1, day!)).toISOString().slice(0, 10)
  if (source !== localDate) throw new Error('Mastery local date is invalid')
  return value.toISOString().slice(0, 10)
}

export function scoreCriteria(criteria: Array<{ key: string, weightPercent: number }>, awarded: Array<{ key: string, awarded: boolean }>) {
  const byKey = new Map(awarded.map(row => [row.key, row.awarded]))
  if (byKey.size !== awarded.length || criteria.some(row => !byKey.has(row.key)) || awarded.some(row => !criteria.some(criterion => criterion.key === row.key))) throw new Error('Criterion results do not match the pinned rubric')
  const total = criteria.reduce((sum, row) => sum + row.weightPercent, 0)
  if (total !== 100) throw new Error('Pinned rubric weights are invalid')
  return criteria.reduce((sum, row) => sum + (byKey.get(row.key) ? row.weightPercent : 0), 0)
}

export function deriveMastery(input: { scorePercent: number, assisted: boolean, kind: 'calibration' | 'guided_application' | 'independent_application' | 'retained_transfer', previousState?: MasteryState, firstIndependentLocalDate?: string, attemptLocalDate?: string }) {
  const previousState = input.previousState ?? 'unseen'
  if (input.kind === 'retained_transfer') {
    if ((previousState !== 'independent' && previousState !== 'retained') || !input.firstIndependentLocalDate || !input.attemptLocalDate || input.attemptLocalDate < addCalendarDays(input.firstIndependentLocalDate, 7)) throw new Error('Retained transfer is not eligible until seven calendar days after the first independent pass')
  }
  const passed = input.scorePercent >= LEARN_V2_MASTERY_THRESHOLD
  const event: MasteryEvent = input.kind === 'calibration'
    ? (passed && !input.assisted ? 'calibration_pass' : 'calibration_nonqualifying')
    : input.kind === 'guided_application'
      ? (passed ? 'guided_pass' : 'guided_fail')
      : input.kind === 'retained_transfer' && input.assisted
        ? 'delayed_assisted'
        : !passed
          ? (input.kind === 'retained_transfer' ? 'delayed_fail' : 'independent_fail')
          : input.assisted
            ? 'assisted_pass'
            : input.kind === 'retained_transfer' ? 'delayed_pass' : 'independent_pass'
  return deriveMasteryTransition(previousState, event, input.firstIndependentLocalDate)
}
