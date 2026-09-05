export interface ModelOption {
  label: string
  value: string
  recommended?: boolean
}

export const MODELS: ModelOption[] = [
  { label: 'Claude Sonnet 4.5', value: 'anthropic/claude-sonnet-4-5' },
  { label: 'Claude Haiku 3.5', value: 'anthropic/claude-3.5-haiku' },
  { label: 'GPT-4o', value: 'openai/gpt-4o' },
  { label: 'GPT-4o Mini', value: 'openai/gpt-4o-mini', recommended: true },
  { label: 'Gemini 2.5 Flash', value: 'google/gemini-2.5-flash-preview' },
  { label: 'Llama 3.1 70B', value: 'meta-llama/llama-3.1-70b-instruct' },
  { label: 'DeepSeek V3', value: 'deepseek/deepseek-chat-v3-0324' },
  { label: 'Mistral Large', value: 'mistralai/mistral-large-latest' },
]

export const DEFAULT_MODEL = MODELS.find(m => m.recommended)?.value ?? MODELS[0]!.value

export function getModelLabel(value: string): string {
  return MODELS.find(m => m.value === value)?.label ?? value
}

export function isValidModel(value: string): boolean {
  return MODELS.some(m => m.value === value)
}
