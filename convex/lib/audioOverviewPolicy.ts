// Temporarily elevated while the generation pipeline is being exercised in beta.
export const AUDIO_OVERVIEW_DAILY_CAP = 100
export const AUDIO_OVERVIEW_MAX_EXPLICIT_SOURCES = 50

// Budget values are micro-USD (1 USD = 1,000,000 micro-USD). Script generation
// has a meaningful fixed cost because its grounded JSON includes a Claim
// Ledger. Reserve all three bounded script attempts, one final exact-evidence
// verification, and the per-minute media pipeline. This is a spend ceiling,
// not an expected charge.
export const AUDIO_OVERVIEW_MAX_JOB_BUDGET_MICRO_USD = 450_000
export const AUDIO_OVERVIEW_DIALOGUE_PLAN_BUDGET_MICRO_USD = 25_000
export const AUDIO_OVERVIEW_ENTAILMENT_VERIFICATION_BUDGET_MICRO_USD = 8_000
export const AUDIO_OVERVIEW_SCRIPT_BUDGET_MICRO_USD
  = AUDIO_OVERVIEW_DIALOGUE_PLAN_BUDGET_MICRO_USD
    + AUDIO_OVERVIEW_ENTAILMENT_VERIFICATION_BUDGET_MICRO_USD
const AUDIO_OVERVIEW_RENDER_AND_QUALITY_MICRO_USD_PER_MINUTE = 15_510
const AUDIO_OVERVIEW_ALIGNMENT_MICRO_USD_PER_MINUTE = 510

export function reserveAudioOverviewBudgetMicrousd(lengthMinutes: 5 | 10 | 20): number {
  return Math.min(
    AUDIO_OVERVIEW_MAX_JOB_BUDGET_MICRO_USD,
    AUDIO_OVERVIEW_SCRIPT_BUDGET_MICRO_USD * 3
      + AUDIO_OVERVIEW_ENTAILMENT_VERIFICATION_BUDGET_MICRO_USD
      + lengthMinutes * (
        AUDIO_OVERVIEW_RENDER_AND_QUALITY_MICRO_USD_PER_MINUTE
        + AUDIO_OVERVIEW_ALIGNMENT_MICRO_USD_PER_MINUTE
      ),
  )
}

export function estimateAudioOverviewCostMicrousd(
  renderedAttemptDurationMs: number,
  publishedDurationMs: number,
): number {
  const renderMinutes = Math.max(0, renderedAttemptDurationMs) / 60_000
  const publishedMinutes = Math.max(0, publishedDurationMs) / 60_000
  return Math.ceil(
    AUDIO_OVERVIEW_SCRIPT_BUDGET_MICRO_USD
      + renderMinutes * AUDIO_OVERVIEW_RENDER_AND_QUALITY_MICRO_USD_PER_MINUTE
      + publishedMinutes * AUDIO_OVERVIEW_ALIGNMENT_MICRO_USD_PER_MINUTE,
  )
}

export function estimateAudioOverviewSceneAttemptMicrousd(durationMs: number): number {
  return Math.ceil(Math.max(0, durationMs) / 60_000 * AUDIO_OVERVIEW_RENDER_AND_QUALITY_MICRO_USD_PER_MINUTE)
}

export function estimateAudioOverviewAlignmentMicrousd(durationMs: number): number {
  return Math.ceil(Math.max(0, durationMs) / 60_000 * AUDIO_OVERVIEW_ALIGNMENT_MICRO_USD_PER_MINUTE)
}

export function todayUtcYmd(): string {
  return new Date().toISOString().slice(0, 10)
}
