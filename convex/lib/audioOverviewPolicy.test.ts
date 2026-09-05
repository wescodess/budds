import { describe, expect, test } from 'vitest'
import {
  AUDIO_OVERVIEW_DIALOGUE_PLAN_BUDGET_MICRO_USD,
  AUDIO_OVERVIEW_ENTAILMENT_VERIFICATION_BUDGET_MICRO_USD,
  AUDIO_OVERVIEW_SCRIPT_BUDGET_MICRO_USD,
  reserveAudioOverviewBudgetMicrousd,
} from './audioOverviewPolicy'

describe('Audio Overview script budget', () => {
  test('reserves the plan and entailment calls together under the finite script ceiling', () => {
    expect(AUDIO_OVERVIEW_DIALOGUE_PLAN_BUDGET_MICRO_USD).toBe(25_000)
    expect(AUDIO_OVERVIEW_ENTAILMENT_VERIFICATION_BUDGET_MICRO_USD).toBe(8_000)
    expect(AUDIO_OVERVIEW_SCRIPT_BUDGET_MICRO_USD).toBe(
      AUDIO_OVERVIEW_DIALOGUE_PLAN_BUDGET_MICRO_USD
      + AUDIO_OVERVIEW_ENTAILMENT_VERIFICATION_BUDGET_MICRO_USD,
    )
    expect(AUDIO_OVERVIEW_SCRIPT_BUDGET_MICRO_USD).toBeLessThanOrEqual(reserveAudioOverviewBudgetMicrousd(5))
    expect(reserveAudioOverviewBudgetMicrousd(5)).toBe(187_100)
    expect(reserveAudioOverviewBudgetMicrousd(10)).toBe(267_200)
    expect(reserveAudioOverviewBudgetMicrousd(20)).toBe(427_400)
  })
})
