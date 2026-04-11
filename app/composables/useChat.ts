import type { Id } from '../../convex/_generated/dataModel'

export interface Source {
  content: string
  score: number
  filename: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
}

interface ChatResponse {
  answer: string
  model: string
  usage: Record<string, unknown>
  sources: Array<{
    content: string
    score: number
    attributes: { filename?: string }
  }>
}

const DEFAULT_MODEL = 'openai/gpt-4o-mini'

export function useChat(folderId: Ref<Id<'folders'>>) {
  const { documents } = useDocuments(folderId)

  const messages = ref<ChatMessage[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const hasIndexedDocuments = computed(() =>
    documents.value?.some(d => d.status === 'success') ?? false,
  )

  async function sendMessage(query: string) {
    error.value = null
    messages.value.push({ role: 'user', content: query })
    loading.value = true

    try {
      const data = await $fetch<ChatResponse>('/api/rag/chat', {
        method: 'POST',
        body: {
          query,
          model: DEFAULT_MODEL,
          folderId: folderId.value,
        },
      })

      const sources: Source[] = data.sources?.map(s => ({
        content: s.content,
        score: s.score,
        filename: s.attributes?.filename ?? 'Unknown',
      })) ?? []

      messages.value.push({
        role: 'assistant',
        content: data.answer ?? '',
        sources,
      })
    } catch (e: any) {
      error.value = e.data?.message || e.message || 'Failed to get response'
    } finally {
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
    hasIndexedDocuments,
    sendMessage,
    clearMessages,
  }
}
