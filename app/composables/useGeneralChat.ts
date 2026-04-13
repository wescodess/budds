interface GeneralMessage {
  role: 'user' | 'assistant'
  content: string
}

export function useGeneralChat() {
  const messages = ref<GeneralMessage[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function send(query: string, model: string) {
    error.value = null
    loading.value = true

    messages.value.push({ role: 'user', content: query })

    const history = messages.value.slice(0, -1).map(({ role, content }) => ({ role, content }))

    try {
      const response = await $fetch<{ answer: string }>('/api/chat/general', {
        method: 'POST',
        body: { query, model, history },
      })
      messages.value.push({ role: 'assistant', content: response.answer })
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

  function clear() {
    messages.value = []
    error.value = null
  }

  return { messages, loading, error, send, clear }
}
