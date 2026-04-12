import { useMediaQuery } from '@vueuse/core'
import type { Id } from '../../convex/_generated/dataModel'

export interface Source {
  content: string
  score: number
  filename: string
}

export interface UIChatMessage {
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

interface RawSource {
  content: string
  score: number
  attributes: { filename?: string }
}

const DEFAULT_MODEL = 'openai/gpt-4o-mini'

function mapSources(raw: RawSource[]): Source[] {
  return raw.map(s => ({
    content: s.content,
    score: s.score,
    filename: s.attributes?.filename ?? 'Unknown',
  }))
}

export function useChat(folderId: Ref<Id<'folders'>>) {
  const { documents } = useDocuments(folderId)
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

  const messages = ref<UIChatMessage[]>([])
  const loading = ref(false)
  const streaming = ref(false)
  const error = ref<string | null>(null)

  const hasIndexedDocuments = computed(() =>
    documents.value?.some(d => d.status === 'success') ?? false,
  )

  async function sendStreaming(query: string): Promise<boolean> {
    const response = await fetch('/api/rag/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        model: DEFAULT_MODEL,
        folderId: folderId.value,
        stream: true,
      }),
    })

    if (!response.ok || !response.body) return false

    messages.value.push({ role: 'assistant', content: '', sources: [] })
    const assistantMsg = messages.value[messages.value.length - 1]!
    streaming.value = true

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let currentEventType = ''
    let tokenBuffer = ''

    const flushTokenBuffer = () => {
      if (tokenBuffer) {
        assistantMsg.content += tokenBuffer
        tokenBuffer = ''
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim()
            continue
          }

          if (line.startsWith('data: ')) {
            const data = line.slice(6)

            if (data === '[DONE]') {
              flushTokenBuffer()
              streaming.value = false
              continue
            }

            if (currentEventType === 'sources') {
              try {
                const rawSources: RawSource[] = JSON.parse(data)
                assistantMsg.sources = mapSources(rawSources)
              } catch (e) {
                if (import.meta.dev) console.warn('[useChat] Failed to parse sources SSE data:', data, e)
              }
              currentEventType = ''
              continue
            }

            try {
              const parsed = JSON.parse(data)
              const token = parsed.choices?.[0]?.delta?.content
              if (token) {
                if (prefersReducedMotion.value) {
                  tokenBuffer += token
                  if (tokenBuffer.length >= 50 || /[.!?]\s*$/.test(tokenBuffer)) {
                    flushTokenBuffer()
                  }
                } else {
                  assistantMsg.content += token
                }
              }
            } catch (e) {
              if (import.meta.dev) console.warn('[useChat] Failed to parse SSE delta:', data, e)
            }
          }

          if (line.trim() === '') {
            currentEventType = ''
          }
        }
      }
    } finally {
      flushTokenBuffer()
      streaming.value = false
    }

    return true
  }

  async function sendNonStreaming(query: string) {
    const data = await $fetch<ChatResponse>('/api/rag/chat', {
      method: 'POST',
      body: {
        query,
        model: DEFAULT_MODEL,
        folderId: folderId.value,
      },
    })

    messages.value.push({
      role: 'assistant',
      content: data.answer ?? '',
      sources: mapSources(data.sources ?? []),
    })
  }

  async function sendMessage(query: string) {
    if (loading.value) return
    error.value = null
    messages.value.push({ role: 'user', content: query })
    loading.value = true

    try {
      const streamingIdx = messages.value.length
      const streamed = await sendStreaming(query).catch(() => false)

      if (!streamed) {
        if (messages.value[streamingIdx]?.role === 'assistant') {
          messages.value.splice(streamingIdx, 1)
        }
        await sendNonStreaming(query)
      }
    } catch (e: any) {
      error.value = e.data?.message || e.message || 'Failed to get response'
    } finally {
      loading.value = false
      streaming.value = false
    }
  }

  function clearMessages() {
    messages.value = []
    error.value = null
  }

  return {
    messages,
    loading,
    streaming,
    error,
    hasIndexedDocuments,
    sendMessage,
    clearMessages,
  }
}
