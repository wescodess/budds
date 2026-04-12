const MODEL_ALLOWLIST = new Set([
  'anthropic/claude-sonnet-4-5',
  'anthropic/claude-3.5-haiku',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'google/gemini-2.5-flash-preview',
  'meta-llama/llama-3.1-70b-instruct',
  'deepseek/deepseek-chat-v3-0324',
  'mistralai/mistral-large-latest',
])

export const SERVER_DEFAULT_MODEL = 'openai/gpt-4o-mini'

if (!MODEL_ALLOWLIST.has(SERVER_DEFAULT_MODEL)) {
  throw new Error(`SERVER_DEFAULT_MODEL "${SERVER_DEFAULT_MODEL}" is not in MODEL_ALLOWLIST`)
}

export function isAllowedModel(model: string): boolean {
  return MODEL_ALLOWLIST.has(model)
}
