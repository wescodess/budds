interface RagSource {
  content: string
  score: number
  attributes: Record<string, unknown>
}

interface RagMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: RagSource[]
}

interface ChatOptions {
  model: string
  temperature?: number
  max_tokens?: number
  max_num_results?: number
  score_threshold?: number
  filters?: Record<string, unknown>
}

export function useRag() {
  const messages = ref<RagMessage[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function chat(query: string, options: ChatOptions) {
    error.value = null
    loading.value = true

    messages.value.push({ role: 'user', content: query })

    const history = messages.value
      .slice(0, -1)
      .map(({ role, content }) => ({ role, content }))

    try {
      const response = await $fetch('/api/rag/chat', {
        method: 'POST',
        body: {
          query,
          model: options.model,
          history,
          temperature: options.temperature,
          max_tokens: options.max_tokens,
          max_num_results: options.max_num_results,
          score_threshold: options.score_threshold,
          filters: options.filters,
        },
      })

      messages.value.push({
        role: 'assistant',
        content: response.answer,
        sources: response.sources,
      })

      return response
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to get response'
      error.value = message
      messages.value.pop()
      throw err
    }
    finally {
      loading.value = false
    }
  }

  async function search(query: string, options?: {
    max_num_results?: number
    score_threshold?: number
    filters?: Record<string, unknown>
  }) {
    error.value = null
    loading.value = true

    try {
      return await $fetch('/api/rag/search', {
        method: 'POST',
        body: {
          query,
          ...options,
        },
      })
    }
    catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Search failed'
      error.value = message
      throw err
    }
    finally {
      loading.value = false
    }
  }

  function clearMessages() {
    messages.value = []
    error.value = null
  }

  return {
    messages,
    loading,
    error,
    chat,
    search,
    clearMessages,
  }
}
