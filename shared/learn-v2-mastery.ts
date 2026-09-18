export const LEARN_V2_MASTERY_SCORER_VERSION = 'learn-v2.mastery-scorer.v1'
export const LEARN_V2_MASTERY_THRESHOLD = 80

export type MasteryState = 'guided' | 'independent' | 'retained' | 'needs_review'

export function localDateAt(utcMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(utcMs)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

// Calendar arithmetic intentionally uses ISO dates, rather than 24-hour
// intervals, so the seven-day rule is stable through DST transitions.
export function addCalendarDays(localDate: string, days: number) {
  const [year, month, day] = localDate.split('-').map(Number)
  const value = new Date(Date.UTC(year!, month! - 1, day! + days))
  return value.toISOString().slice(0, 10)
}

export function scoreCriteria(criteria: Array<{ key: string, weightPercent: number }>, awarded: Array<{ key: string, awarded: boolean }>) {
  const byKey = new Map(awarded.map(row => [row.key, row.awarded]))
  if (byKey.size !== awarded.length || criteria.some(row => !byKey.has(row.key)) || awarded.some(row => !criteria.some(criterion => criterion.key === row.key))) throw new Error('Criterion results do not match the pinned rubric')
  const total = criteria.reduce((sum, row) => sum + row.weightPercent, 0)
  if (total !== 100) throw new Error('Pinned rubric weights are invalid')
  return criteria.reduce((sum, row) => sum + (byKey.get(row.key) ? row.weightPercent : 0), 0)
}

export function deriveMastery(input: { scorePercent: number, assisted: boolean, kind: 'independent_application' | 'retained_transfer', previousState?: string, firstIndependentLocalDate?: string, attemptLocalDate: string }) {
  if (input.scorePercent < LEARN_V2_MASTERY_THRESHOLD) return { state: 'needs_review' as const, remediation: true, setFirstIndependent: false }
  if (input.assisted) return { state: (input.previousState === 'independent' || input.previousState === 'retained' ? input.previousState : 'guided') as MasteryState, remediation: false, setFirstIndependent: false }
  if (input.kind === 'retained_transfer') {
    if (!input.firstIndependentLocalDate || input.attemptLocalDate < addCalendarDays(input.firstIndependentLocalDate, 7)) throw new Error('Retained transfer is not eligible until seven calendar days after the first independent pass')
    return { state: 'retained' as const, remediation: false, setFirstIndependent: false }
  }
  return { state: 'independent' as const, remediation: false, setFirstIndependent: !input.firstIndependentLocalDate }
}
