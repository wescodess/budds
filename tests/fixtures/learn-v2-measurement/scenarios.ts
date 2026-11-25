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
  day7: { population: 50, pairs: 20, observed: 25, bounds: [0, 70], accepted: 40,
    dispositions: { valid_scored: 20, abandoned: 10, missing_cold: 5, assisted_contaminated: 10, scoring_pending: 5 } },
  day30: { population: 50, pairs: 35, observed: 400 / 7, bounds: [30, 70], accepted: 45,
    dispositions: { valid_scored: 35, abandoned: 5, missing_cold: 5, assisted_contaminated: 0, scoring_pending: 5 } },
  firstCheck: { population: 50, checked: 25, failed: 10, observed: 2 / 5, bounds: [1 / 5, 7 / 10] },
} as const
