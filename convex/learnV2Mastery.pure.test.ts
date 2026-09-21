import { describe, expect, test } from 'vitest'
import { addCalendarDays, deriveMastery, masteryAttemptTime, scoreCriteria } from '../shared/learn-v2-mastery'

describe('Learn V2 mastery derivation', () => {
  const criteria = [{ key: 'a', weightPercent: 80 }, { key: 'b', weightPercent: 20 }]
  const states = ['unseen', 'learning', 'guided', 'independent', 'retained', 'needs_review', 'blocked', 'provisionally_known'] as const
  test('uses rubric weights at the 79/80 boundary', () => {
    expect(scoreCriteria(criteria, [{ key: 'a', awarded: true }, { key: 'b', awarded: false }])).toBe(80)
    expect(deriveMastery({ scorePercent: 79, assisted: false, kind: 'independent_application', attemptLocalDate: '2026-03-01' })).toMatchObject({ state: 'needs_review', remediation: true })
  })
  test('returns an explicit versioned transition decision', () => {
    expect(deriveMastery({ scorePercent: 80, assisted: false, kind: 'independent_application', previousState: 'guided', attemptLocalDate: '2026-03-01' })).toMatchObject({
      previousState: 'guided',
      state: 'independent',
      transitionVersion: 'learn-v2.mastery-transition.v1',
      reason: 'unassisted_pass_independent',
    })
  })
  test('defines ordinary pass, assisted pass, and failed-check outcomes for every stored state', () => {
    expect(states.map(previousState => ({
      previousState,
      independentPass: deriveMastery({ scorePercent: 80, assisted: false, kind: 'independent_application', previousState }).state,
      assistedPass: deriveMastery({ scorePercent: 100, assisted: true, kind: 'independent_application', previousState }).state,
      failedCheck: deriveMastery({ scorePercent: 79, assisted: false, kind: 'independent_application', previousState }).state,
    }))).toEqual([
      { previousState: 'unseen', independentPass: 'independent', assistedPass: 'guided', failedCheck: 'needs_review' },
      { previousState: 'learning', independentPass: 'independent', assistedPass: 'guided', failedCheck: 'needs_review' },
      { previousState: 'guided', independentPass: 'independent', assistedPass: 'guided', failedCheck: 'needs_review' },
      { previousState: 'independent', independentPass: 'independent', assistedPass: 'independent', failedCheck: 'needs_review' },
      { previousState: 'retained', independentPass: 'retained', assistedPass: 'retained', failedCheck: 'retained' },
      { previousState: 'needs_review', independentPass: 'independent', assistedPass: 'guided', failedCheck: 'needs_review' },
      { previousState: 'blocked', independentPass: 'independent', assistedPass: 'guided', failedCheck: 'needs_review' },
      { previousState: 'provisionally_known', independentPass: 'independent', assistedPass: 'guided', failedCheck: 'needs_review' },
    ])
  })
  test('assistance caps without downgrading established mastery', () => {
    expect(deriveMastery({ scorePercent: 100, assisted: true, kind: 'independent_application', previousState: 'independent', attemptLocalDate: '2026-03-01' }).state).toBe('independent')
    expect(deriveMastery({ scorePercent: 100, assisted: true, kind: 'independent_application', attemptLocalDate: '2026-03-01' }).state).toBe('guided')
  })
  test('failed assisted application checks enter remediation without qualifying as retained checks', () => {
    expect(deriveMastery({ scorePercent: 79, assisted: true, kind: 'independent_application', previousState: 'independent', attemptLocalDate: '2026-03-08' })).toMatchObject({ state: 'needs_review', remediation: true })
    expect(deriveMastery({ scorePercent: 79, assisted: true, kind: 'retained_transfer', previousState: 'retained', firstIndependentLocalDate: '2026-03-01', attemptLocalDate: '2026-03-08' })).toMatchObject({ state: 'retained', remediation: false, reason: 'assisted_mastery_preserved' })
  })
  test('calibration cannot regress an earned or protected state', () => {
    for (const previousState of ['guided', 'independent', 'retained', 'needs_review', 'blocked', 'provisionally_known'] as const) {
      expect(deriveMastery({ scorePercent: 0, assisted: false, kind: 'calibration', previousState })).toMatchObject({ state: previousState, reason: 'calibration_mastery_preserved' })
      expect(deriveMastery({ scorePercent: 100, assisted: false, kind: 'calibration', previousState })).toMatchObject({ state: previousState, reason: 'calibration_mastery_preserved' })
    }
  })
  test('preserves retained mastery unless an eligible delayed check fails', () => {
    expect(deriveMastery({ scorePercent: 100, assisted: false, kind: 'independent_application', previousState: 'retained', firstIndependentLocalDate: '2026-03-01', attemptLocalDate: '2026-03-09' }).state).toBe('retained')
    expect(deriveMastery({ scorePercent: 79, assisted: false, kind: 'independent_application', previousState: 'retained', firstIndependentLocalDate: '2026-03-01', attemptLocalDate: '2026-03-09' }).state).toBe('retained')
    expect(deriveMastery({ scorePercent: 79, assisted: false, kind: 'retained_transfer', previousState: 'retained', firstIndependentLocalDate: '2026-03-01', attemptLocalDate: '2026-03-09' })).toMatchObject({ state: 'needs_review', remediation: true })
  })
  test('enforces seven calendar days, including DST calendar arithmetic', () => {
    expect(() => deriveMastery({ scorePercent: 80, assisted: false, kind: 'retained_transfer', previousState: 'independent', firstIndependentLocalDate: '2026-03-01', attemptLocalDate: '2026-03-07' })).toThrow(/seven calendar days/)
    expect(addCalendarDays('2026-03-01', 7)).toBe('2026-03-08')
    expect(deriveMastery({ scorePercent: 80, assisted: false, kind: 'retained_transfer', previousState: 'independent', firstIndependentLocalDate: '2026-03-01', attemptLocalDate: '2026-03-08' }).state).toBe('retained')
  })
  test('derives the attempt date from an injected clock at exact local boundaries', () => {
    expect(masteryAttemptTime('America/Toronto', { now: () => Date.parse('2026-03-08T04:59:59.999Z') })).toEqual({ attemptedAt: Date.parse('2026-03-08T04:59:59.999Z'), localDate: '2026-03-07' })
    expect(masteryAttemptTime('America/Toronto', { now: () => Date.parse('2026-03-08T05:00:00.000Z') })).toEqual({ attemptedAt: Date.parse('2026-03-08T05:00:00.000Z'), localDate: '2026-03-08' })
    expect(masteryAttemptTime('Asia/Kolkata', { now: () => Date.parse('2026-03-07T18:30:00.000Z') }).localDate).toBe('2026-03-08')
    expect(() => masteryAttemptTime('Not/A_Zone', { now: () => 0 })).toThrow()
    expect(() => addCalendarDays('2026-02-30', 7)).toThrow(/local date/i)
  })
})
