export const ADAPTIVE_FEEDBACK_TEMPLATE_VERSION = 'learn-adaptive.feedback-templates.v1' as const
export const ADAPTIVE_MISCONCEPTION_TAXONOMY_VERSION = 'learn-adaptive.misconception-taxonomy.v1' as const

export const ADAPTIVE_MISCONCEPTION_TAGS = [
  'missing_required_step',
  'unsupported_claim',
  'confused_concepts',
  'incorrect_sequence',
  'scope_overgeneralization',
  'incomplete_transfer',
  'calculation_or_unit_error',
  'evidence_mismatch',
] as const

export type AdaptiveMisconceptionTag = typeof ADAPTIVE_MISCONCEPTION_TAGS[number]
export type AdaptiveFeedbackTemplate = 'criterion_met' | 'criterion_not_met' | 'evidence_insufficient' | 'response_incomplete' | 'provider_unavailable'

const TEMPLATE_COPY: Record<AdaptiveFeedbackTemplate, string> = {
  criterion_met: '{criterion}: criterion met.',
  criterion_not_met: '{criterion}: criterion not met yet.',
  evidence_insufficient: 'The available evidence is not sufficient to score this response.',
  response_incomplete: 'The response is incomplete. Add the missing required parts and try again.',
  provider_unavailable: 'Your response was saved. Scoring needs review, and no mastery change was made.',
}

export function renderControlledFeedbackTemplate(template: AdaptiveFeedbackTemplate, criterionLabel?: string) {
  const copy = TEMPLATE_COPY[template]
  if (!copy.includes('{criterion}')) return copy
  if (!criterionLabel?.trim() || criterionLabel.length > 160) throw new Error('Pinned criterion label is invalid')
  return copy.replace('{criterion}', criterionLabel.trim())
}

export type ControlledFeedbackProjection = {
  templateVersion: typeof ADAPTIVE_FEEDBACK_TEMPLATE_VERSION
  taxonomyVersion: typeof ADAPTIVE_MISCONCEPTION_TAXONOMY_VERSION
  criterionResults: Array<{
    key: string
    label: string
    awarded: boolean
    template: 'criterion_met' | 'criterion_not_met'
    message: string
  }>
  misconceptionTags: AdaptiveMisconceptionTag[]
  misconceptionFeedback: Array<{
    tag: AdaptiveMisconceptionTag
    template: 'evidence_insufficient' | 'response_incomplete'
    message: string
  }>
}

const MISCONCEPTION_TEMPLATES: Record<AdaptiveMisconceptionTag, 'evidence_insufficient' | 'response_incomplete'> = {
  missing_required_step: 'response_incomplete',
  unsupported_claim: 'evidence_insufficient',
  confused_concepts: 'response_incomplete',
  incorrect_sequence: 'response_incomplete',
  scope_overgeneralization: 'evidence_insufficient',
  incomplete_transfer: 'response_incomplete',
  calculation_or_unit_error: 'response_incomplete',
  evidence_mismatch: 'evidence_insufficient',
}

export function projectControlledFeedback(input: {
  criteria: Array<{ key: string, label: string }>
  outcomes: Array<{ key: string, awarded: boolean, rationale?: unknown }>
  misconceptionTags: string[]
}): ControlledFeedbackProjection {
  const allowedTags = new Set<string>(ADAPTIVE_MISCONCEPTION_TAGS)
  const uniqueTags = new Set(input.misconceptionTags)
  if (input.misconceptionTags.length > ADAPTIVE_MISCONCEPTION_TAGS.length
    || uniqueTags.size !== input.misconceptionTags.length
    || input.misconceptionTags.some(tag => !allowedTags.has(tag))) {
    throw new Error('Provider misconception taxonomy is invalid')
  }

  const criteriaByKey = new Map(input.criteria.map(criterion => [criterion.key, criterion]))
  const outcomesByKey = new Map(input.outcomes.map(outcome => [outcome.key, outcome]))
  if (criteriaByKey.size !== input.criteria.length || outcomesByKey.size !== input.outcomes.length
    || input.criteria.length !== input.outcomes.length
    || input.criteria.some(criterion => !outcomesByKey.has(criterion.key))
    || input.outcomes.some(outcome => !criteriaByKey.has(outcome.key))) {
    throw new Error('Provider outcomes do not match the pinned criteria')
  }

  return {
    templateVersion: ADAPTIVE_FEEDBACK_TEMPLATE_VERSION,
    taxonomyVersion: ADAPTIVE_MISCONCEPTION_TAXONOMY_VERSION,
    criterionResults: input.criteria.map((criterion) => {
      if (!criterion.key.trim() || criterion.key.length > 64 || !criterion.label.trim() || criterion.label.length > 160) throw new Error('Pinned criterion label is invalid')
      const outcome = outcomesByKey.get(criterion.key)!
      const template = outcome.awarded ? 'criterion_met' as const : 'criterion_not_met' as const
      return { key: criterion.key, label: criterion.label.trim(), awarded: outcome.awarded, template, message: renderControlledFeedbackTemplate(template, criterion.label) }
    }),
    misconceptionTags: input.misconceptionTags as AdaptiveMisconceptionTag[],
    misconceptionFeedback: (input.misconceptionTags as AdaptiveMisconceptionTag[]).map(tag => ({
      tag,
      template: MISCONCEPTION_TEMPLATES[tag],
      message: renderControlledFeedbackTemplate(MISCONCEPTION_TEMPLATES[tag]),
    })),
  }
}
