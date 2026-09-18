import { describe, expect, test } from 'vitest'
import { addCalendarDays, deriveMastery, scoreCriteria } from '../shared/learn-v2-mastery'

describe('Learn V2 mastery derivation', () => {
  const criteria = [{ key: 'a', weightPercent: 80 }, { key: 'b', weightPercent: 20 }]
  test('uses rubric weights at the 79/80 boundary', () => {
    expect(scoreCriteria(criteria, [{ key: 'a', awarded: true }, { key: 'b', awarded: false }])).toBe(80)
    expect(deriveMastery({ scorePercent: 79, assisted: false, kind: 'independent_application', attemptLocalDate: '2026-03-01' })).toMatchObject({ state: 'needs_review', remediation: true })
  })
  test('assistance caps without downgrading established mastery', () => {
    expect(deriveMastery({ scorePercent: 100, assisted: true, kind: 'independent_application', previousState: 'independent', attemptLocalDate: '2026-03-01' }).state).toBe('independent')
    expect(deriveMastery({ scorePercent: 100, assisted: true, kind: 'independent_application', attemptLocalDate: '2026-03-01' }).state).toBe('guided')
  })
  test('enforces seven calendar days, including DST calendar arithmetic', () => {
    expect(() => deriveMastery({ scorePercent: 80, assisted: false, kind: 'retained_transfer', firstIndependentLocalDate: '2026-03-01', attemptLocalDate: '2026-03-07' })).toThrow(/seven calendar days/)
    expect(addCalendarDays('2026-03-01', 7)).toBe('2026-03-08')
    expect(deriveMastery({ scorePercent: 80, assisted: false, kind: 'retained_transfer', firstIndependentLocalDate: '2026-03-01', attemptLocalDate: '2026-03-08' }).state).toBe('retained')
  })
})
