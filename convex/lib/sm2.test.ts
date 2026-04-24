import { describe, expect, test } from 'vitest'
import { computeSM2 } from './sm2'
import type { SM2Params } from './sm2'

const DEFAULT_PARAMS: SM2Params = {
  easeFactor: 2.5,
  interval: 1,
  repetitions: 0,
}

const TODAY = '2026-04-23'

describe('computeSM2', () => {
  describe('Again (quality 0)', () => {
    test('resets interval to 1 and repetitions to 0', () => {
      const result = computeSM2(
        { easeFactor: 2.5, interval: 10, repetitions: 5 },
        0,
        TODAY,
      )
      expect(result.interval).toBe(1)
      expect(result.repetitions).toBe(0)
    })

    test('decreases easeFactor', () => {
      const result = computeSM2(DEFAULT_PARAMS, 0, TODAY)
      expect(result.easeFactor).toBe(1.7)
    })

    test('easeFactor does not go below 1.3', () => {
      const result = computeSM2({ ...DEFAULT_PARAMS, easeFactor: 1.3 }, 0, TODAY)
      expect(result.easeFactor).toBe(1.3)
    })

    test('nextReviewDate is tomorrow', () => {
      const result = computeSM2(DEFAULT_PARAMS, 0, TODAY)
      expect(result.nextReviewDate).toBe('2026-04-24')
    })
  })

  describe('Hard (quality 3)', () => {
    test('multiplies interval by 1.2', () => {
      const result = computeSM2(
        { easeFactor: 2.5, interval: 10, repetitions: 3 },
        3,
        TODAY,
      )
      expect(result.interval).toBe(12)
    })

    test('increments repetitions', () => {
      const result = computeSM2(
        { easeFactor: 2.5, interval: 5, repetitions: 2 },
        3,
        TODAY,
      )
      expect(result.repetitions).toBe(3)
    })

    test('adjusts easeFactor correctly', () => {
      const result = computeSM2(DEFAULT_PARAMS, 3, TODAY)
      // 2.5 + 0.1 - (5-3) * (0.08 + (5-3) * 0.02)
      // = 2.5 + 0.1 - 2 * (0.08 + 0.04) = 2.6 - 0.24 = 2.36
      expect(result.easeFactor).toBe(2.36)
    })

    test('rounds interval', () => {
      const result = computeSM2(
        { easeFactor: 2.5, interval: 3, repetitions: 1 },
        3,
        TODAY,
      )
      // 3 * 1.2 = 3.6 -> rounds to 4
      expect(result.interval).toBe(4)
    })

    test('sets nextReviewDate correctly', () => {
      const result = computeSM2(
        { easeFactor: 2.5, interval: 10, repetitions: 3 },
        3,
        TODAY,
      )
      // interval = 12, today + 12 days
      expect(result.nextReviewDate).toBe('2026-05-05')
    })
  })

  describe('Good (quality 4)', () => {
    test('multiplies interval by easeFactor', () => {
      const result = computeSM2(
        { easeFactor: 2.5, interval: 4, repetitions: 2 },
        4,
        TODAY,
      )
      // 4 * 2.5 = 10
      expect(result.interval).toBe(10)
    })

    test('increments repetitions', () => {
      const result = computeSM2(
        { easeFactor: 2.5, interval: 4, repetitions: 2 },
        4,
        TODAY,
      )
      expect(result.repetitions).toBe(3)
    })

    test('adjusts easeFactor correctly', () => {
      const result = computeSM2(DEFAULT_PARAMS, 4, TODAY)
      // 2.5 + 0.1 - (5-4) * (0.08 + (5-4) * 0.02)
      // = 2.5 + 0.1 - 1 * (0.08 + 0.02) = 2.6 - 0.1 = 2.5
      expect(result.easeFactor).toBe(2.5)
    })

    test('sets nextReviewDate correctly', () => {
      const result = computeSM2(
        { easeFactor: 2.5, interval: 4, repetitions: 2 },
        4,
        TODAY,
      )
      // interval = 10
      expect(result.nextReviewDate).toBe('2026-05-03')
    })
  })

  describe('Easy (quality 5)', () => {
    test('multiplies interval by easeFactor * 1.3', () => {
      const result = computeSM2(
        { easeFactor: 2.5, interval: 4, repetitions: 2 },
        5,
        TODAY,
      )
      // 4 * 2.5 * 1.3 = 13
      expect(result.interval).toBe(13)
    })

    test('increments repetitions', () => {
      const result = computeSM2(
        { easeFactor: 2.5, interval: 4, repetitions: 2 },
        5,
        TODAY,
      )
      expect(result.repetitions).toBe(3)
    })

    test('increases easeFactor', () => {
      const result = computeSM2(DEFAULT_PARAMS, 5, TODAY)
      // 2.5 + 0.1 - 0 * (...) = 2.6
      expect(result.easeFactor).toBe(2.6)
    })

    test('sets nextReviewDate correctly', () => {
      const result = computeSM2(
        { easeFactor: 2.5, interval: 4, repetitions: 2 },
        5,
        TODAY,
      )
      // interval = 13
      expect(result.nextReviewDate).toBe('2026-05-06')
    })
  })

  describe('easeFactor floor', () => {
    test('does not go below 1.3 with repeated Again ratings', () => {
      let params: SM2Params = { easeFactor: 1.5, interval: 5, repetitions: 3 }
      for (let i = 0; i < 5; i++) {
        const result = computeSM2(params, 0, TODAY)
        params = { easeFactor: result.easeFactor, interval: result.interval, repetitions: result.repetitions }
      }
      expect(params.easeFactor).toBe(1.3)
    })

    test('stays at exactly 1.3 when already at floor', () => {
      const result = computeSM2(
        { easeFactor: 1.3, interval: 1, repetitions: 0 },
        0,
        TODAY,
      )
      expect(result.easeFactor).toBe(1.3)
    })
  })

  describe('interval minimum', () => {
    test('interval never goes below 1', () => {
      const result = computeSM2(
        { easeFactor: 1.3, interval: 1, repetitions: 0 },
        0,
        TODAY,
      )
      expect(result.interval).toBeGreaterThanOrEqual(1)
    })
  })

  describe('date calculations', () => {
    test('handles month boundary', () => {
      const result = computeSM2(
        { easeFactor: 2.5, interval: 10, repetitions: 3 },
        4,
        '2026-01-25',
      )
      // interval = 25 (10 * 2.5), Jan 25 + 25 = Feb 19
      expect(result.nextReviewDate).toBe('2026-02-19')
    })

    test('handles year boundary', () => {
      const result = computeSM2(
        { easeFactor: 2.5, interval: 10, repetitions: 3 },
        4,
        '2026-12-25',
      )
      // interval = 25, Dec 25 + 25 = Jan 19 2027
      expect(result.nextReviewDate).toBe('2027-01-19')
    })

    test('handles leap year', () => {
      const result = computeSM2(
        { easeFactor: 2.5, interval: 1, repetitions: 0 },
        5,
        '2028-02-28',
      )
      // interval = 1 * 2.5 * 1.3 = 3.25 -> 3
      expect(result.nextReviewDate).toBe('2028-03-02')
    })
  })

  describe('progressive scheduling', () => {
    test('intervals grow with consecutive Good ratings', () => {
      let params: SM2Params = { easeFactor: 2.5, interval: 1, repetitions: 0 }
      const intervals: number[] = []

      for (let i = 0; i < 5; i++) {
        const result = computeSM2(params, 4, TODAY)
        intervals.push(result.interval)
        params = { easeFactor: result.easeFactor, interval: result.interval, repetitions: result.repetitions }
      }

      for (let i = 1; i < intervals.length; i++) {
        expect(intervals[i]).toBeGreaterThanOrEqual(intervals[i - 1]!)
      }
    })

    test('Again resets progress after long streak', () => {
      let params: SM2Params = { easeFactor: 2.5, interval: 1, repetitions: 0 }

      for (let i = 0; i < 5; i++) {
        const result = computeSM2(params, 4, TODAY)
        params = { easeFactor: result.easeFactor, interval: result.interval, repetitions: result.repetitions }
      }

      expect(params.interval).toBeGreaterThan(10)
      expect(params.repetitions).toBe(5)

      const reset = computeSM2(params, 0, TODAY)
      expect(reset.interval).toBe(1)
      expect(reset.repetitions).toBe(0)
    })
  })

  describe('easeFactor computation', () => {
    test('quality 0: max(1.3, ef + 0.1 - 5*(0.08+5*0.02))', () => {
      const result = computeSM2({ easeFactor: 2.5, interval: 1, repetitions: 0 }, 0, TODAY)
      // 2.5 + 0.1 - 5*(0.08+0.10) = 2.6 - 0.9 = 1.7
      expect(result.easeFactor).toBe(1.7)
    })

    test('quality 3: max(1.3, ef + 0.1 - 2*(0.08+2*0.02))', () => {
      const result = computeSM2({ easeFactor: 2.5, interval: 1, repetitions: 0 }, 3, TODAY)
      // 2.5 + 0.1 - 2*(0.08+0.04) = 2.6 - 0.24 = 2.36
      expect(result.easeFactor).toBe(2.36)
    })

    test('quality 4: max(1.3, ef + 0.1 - 1*(0.08+1*0.02))', () => {
      const result = computeSM2({ easeFactor: 2.5, interval: 1, repetitions: 0 }, 4, TODAY)
      // 2.5 + 0.1 - 1*(0.10) = 2.5
      expect(result.easeFactor).toBe(2.5)
    })

    test('quality 5: max(1.3, ef + 0.1 - 0*(...))', () => {
      const result = computeSM2({ easeFactor: 2.5, interval: 1, repetitions: 0 }, 5, TODAY)
      // 2.5 + 0.1 = 2.6
      expect(result.easeFactor).toBe(2.6)
    })
  })
})
