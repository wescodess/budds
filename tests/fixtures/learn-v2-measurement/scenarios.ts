export const measurementScenarios = [
  { name: 'gain', cold: 0, day7: 100, day30: 100 },
  { name: 'negative', cold: 100, day7: 0, day30: 0 },
  { name: 'non_returner', cold: 0, day7: null, day30: null },
  { name: 'absent_cold', cold: null, day7: 100, day30: 100 },
  { name: 'missed_day7', cold: 0, day7: null, day30: 100 },
  { name: 'below_independent_day30', cold: 0, day7: 100, day30: 0 },
  { name: 'first_failure_later_pass', cold: 0, day7: 0, day30: 100 },
  { name: 'unknown', cold: 0, day7: 'unknown', day30: 100 },
  { name: 'assisted', cold: 0, day7: 'assisted', day30: 100 },
  { name: 'unscored', cold: 0, day7: 'unscored', day30: 'unscored' },
] as const

export type MeasurementScenario = typeof measurementScenarios[number]
export type CheckOutcome = MeasurementScenario['cold' | 'day7' | 'day30']

export const expectedMeasurement = {
  day7: { population: 30, pairs: 12, observed: 25, bounds: [0, 70], accepted: 24,
    dispositions: { valid_scored: 12, abandoned: 6, missing_cold: 3, assisted_contaminated: 6, scoring_pending: 3 } },
  day30: { population: 30, pairs: 21, observed: 400 / 7, bounds: [30, 70], accepted: 27,
    dispositions: { valid_scored: 21, abandoned: 3, missing_cold: 3, assisted_contaminated: 0, scoring_pending: 3 } },
  firstCheck: { population: 30, checked: 15, failed: 6, observed: 2 / 5, bounds: [1 / 5, 7 / 10] },
  canvasFirstCheck: { population: 27, checked: 12, failed: 6, observed: 1 / 2, bounds: [2 / 9, 7 / 9] },
} as const
