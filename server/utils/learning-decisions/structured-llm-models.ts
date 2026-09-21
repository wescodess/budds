import policy from '../../../shared/quiz-structured-llm-policy.json'

const STRUCTURED_LLM_MODEL_ALLOWLIST = new Set(policy.modelAllowlist)

export function isAllowedStructuredLlmModel(model: string): boolean {
  return STRUCTURED_LLM_MODEL_ALLOWLIST.has(model)
}

export function structuredLlmProviderPin(model: string): string | undefined {
  return policy.providerPins[model as keyof typeof policy.providerPins]
}

export const STRUCTURED_LLM_REVIEW_CONFIDENCE_THRESHOLD = policy.reviewConfidenceThreshold
