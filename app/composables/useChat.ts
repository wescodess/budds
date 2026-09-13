import { toast } from 'vue-sonner'
import { getErrorMessage } from '~~/shared/errors'
import { useMediaQuery } from '@vueuse/core'
import { api } from '#convex/api'
import type { Id } from '../../convex/_generated/dataModel'
import { normalizeAssistantCitations } from '~/utils/normalize-assistant-citations'
import { createSsrMutationStub } from '~/utils/convexSsrMutation'

import { DEFAULT_MODEL, isValidModel, getModelLabel } from '~/constants/models'

export interface Source {
  content: string
  score: number
  filename: string
}

export interface InterjectionContext {
  overviewId: Id<'audioOverviews'>
  turnIndex: number
  timeMs: number
  quotedText: string
  sourceFilename?: string
}

export interface UIChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  interjectionContext?: InterjectionContext
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
  modelFallback?: { requested: string; actual: string }
}

interface RawSource {
  content: string
  score: number
  attributes: { filename?: string }
}

function mapSources(raw: RawSource[]): Source[] {
  return raw.map(s => ({
    content: s.content,
    score: s.score,
    filename: s.attributes?.filename ?? 'Unknown',
  }))
}

function deriveTitle(query: string): string {
  const trimmed = query.replace(/\s+/g, ' ').trim().slice(0, 60)
  return trimmed || 'New conversation'
}

function normalizeAssistantMessageContent(content: string): string {
  return normalizeAssistantCitations(content)
}

export function useChat(
  folderId: Ref<Id<'folders'>>,
  conversationId?: Ref<Id<'conversations'> | null>,
) {
  const { documents } = useDocuments(folderId)
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const convexClient = import.meta.client ? useConvex() : null

  const messages = ref<UIChatMessage[]>([])
  const loading = ref(false)
  const streaming = ref(false)
  const thinking = ref(false)
  const error = ref<string | null>(null)
  const selectedModel = ref(DEFAULT_MODEL)
  const interjectionInFlight = ref(false)
  const currentConversationId = ref<Id<'conversations'> | null>(conversationId?.value ?? null)
  const audioOverviewStore = useAudioOverviewStore()

  if (conversationId) {
    watch(conversationId, (next) => {
      currentConversationId.value = next
    })
  }

  const createConversationMutation = import.meta.client
    ? useConvexMutation(api.conversations.createConversation)
    : createSsrMutationStub<typeof api.conversations.createConversation>()

  const appendMessageMutation = import.meta.client
    ? useConvexMutation(api.messages.appendMessage)
    : createSsrMutationStub<typeof api.messages.appendMessage>()

  function selectModel(modelValue: string) {
    if (isValidModel(modelValue)) {
      selectedModel.value = modelValue
    }
  }

  const hasIndexedDocuments = computed(() =>
    documents.value?.some(d => d.status === 'success') ?? false,
  )

  async function ensureConversation(query: string): Promise<Id<'conversations'> | null> {
    if (currentConversationId.value) return currentConversationId.value
    if (!import.meta.client) return null

    const newId = (await createConversationMutation.mutate({
      folderId: folderId.value,
      title: deriveTitle(query),
    })) as Id<'conversations'>

    if (createConversationMutation.error.value) {
      const err = createConversationMutation.error.value
      createConversationMutation.error.value = null
      throw err
    }

    currentConversationId.value = newId
    return newId
  }

  async function persistMessage(
    conversationIdValue: Id<'conversations'>,
    role: 'user' | 'assistant',
    content: string,
    extras: { sources?: Source[]; model?: string; interjectionContext?: InterjectionContext } = {},
  ) {
    if (!import.meta.client) return
    await appendMessageMutation.mutate({
      conversationId: conversationIdValue,
      role,
      content,
      ...extras,
    })
    if (appendMessageMutation.error.value) {
      const err = appendMessageMutation.error.value
      appendMessageMutation.error.value = null
      if (import.meta.dev) console.warn('[useChat] Failed to persist message:', err)
    }
  }

  async function sendStreaming(
    query: string,
    scope?: { folderIds?: Id<'folders'>[]; fileIds?: Id<'documents'>[] },
  ): Promise<boolean> {
    const response = await fetch('/api/rag/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        model: selectedModel.value,
        folderId: folderId.value,
        stream: true,
        ...(scope ? { scope } : {}),
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

            if (currentEventType === 'model-fallback') {
              try {
                const fallback = JSON.parse(data) as { requested: string; actual: string }
                selectedModel.value = isValidModel(fallback.actual) ? fallback.actual : DEFAULT_MODEL
                toast.info(`Selected model unavailable, using ${getModelLabel(selectedModel.value)}`)
              } catch (e) {
                if (import.meta.dev) console.warn('[useChat] Failed to parse model-fallback SSE data:', data, e)
              }
              currentEventType = ''
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
                if (thinking.value) thinking.value = false
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

  async function sendNonStreaming(
    query: string,
    scope?: { folderIds?: Id<'folders'>[]; fileIds?: Id<'documents'>[] },
  ) {
    const data = await $fetch<ChatResponse>('/api/rag/chat', {
      method: 'POST',
      body: {
        query,
        model: selectedModel.value,
        folderId: folderId.value,
        ...(scope ? { scope } : {}),
      },
    })

    if (data.modelFallback) {
      selectedModel.value = isValidModel(data.modelFallback.actual) ? data.modelFallback.actual : DEFAULT_MODEL
      toast.info(`Selected model unavailable, using ${getModelLabel(selectedModel.value)}`)
    }

    messages.value.push({
      role: 'assistant',
      content: normalizeAssistantMessageContent(data.answer ?? ''),
      sources: mapSources(data.sources ?? []),
    })
  }

  async function sendMessage(
    query: string,
    scope?: { folderIds?: Id<'folders'>[]; fileIds?: Id<'documents'>[] },
    interjectionContext?: InterjectionContext,
  ) {
    if (loading.value) return
    error.value = null

    let convoId: Id<'conversations'> | null
    try {
      convoId = await ensureConversation(query)
    } catch (e) {
      error.value = getErrorMessage(e, 'Failed to start conversation')
      return
    }

    messages.value.push({
      role: 'user',
      content: query,
      ...(interjectionContext ? { interjectionContext } : {}),
    })
    loading.value = true
    thinking.value = true

    if (convoId) {
      void persistMessage(convoId, 'user', query, interjectionContext ? { interjectionContext } : {})
    }

    if (interjectionContext && import.meta.client) {
      const pausedContinuousOverview = audioOverviewStore.playbackMode.value === 'continuous'
      const resumeAfter = audioOverviewStore.isPlaying.value
      if (pausedContinuousOverview) audioOverviewStore.pause()
      void fireBackgroundInterjection(interjectionContext, query, { pausedContinuousOverview, resumeAfter })
    }

    try {
      const streamingIdx = messages.value.length
      const streamed = await sendStreaming(query, scope).catch(() => false)

      if (!streamed) {
        if (messages.value[streamingIdx]?.role === 'assistant') {
          messages.value.splice(streamingIdx, 1)
        }
        await sendNonStreaming(query, scope)
      }
    } catch (e) {
      error.value = getErrorMessage(e, 'Failed to get response')
    } finally {
      loading.value = false
      streaming.value = false
      thinking.value = false

      const assistantMsg = messages.value[messages.value.length - 1]
      if (
        convoId
        && error.value === null
        && assistantMsg?.role === 'assistant'
        && assistantMsg.content
      ) {
        const normalizedContent = normalizeAssistantMessageContent(assistantMsg.content)
        assistantMsg.content = normalizedContent
        void persistMessage(convoId, 'assistant', normalizedContent, {
          sources: assistantMsg.sources,
          model: selectedModel.value,
        })
      }

    }
  }

  async function fireBackgroundInterjection(
    ctx: InterjectionContext,
    question: string,
    playback: { pausedContinuousOverview: boolean, resumeAfter: boolean },
  ) {
    interjectionInFlight.value = true
    try {
      const result = await $fetch<{
        schemaVersion?: 2
        interjectionId: Id<'audioOverviewInterjections'> | Id<'audioOverviewInterjectionsV2'>
        insertedAfterTurnIndex: number
        artifactUrl?: string
        utterances?: Array<{
          speaker: 'host_a' | 'host_b'
          text: string
          sourceIds?: string[]
        }>
        turns: Array<{
          speaker: 'host_a' | 'host_b'
          text: string
          audioFileId?: Id<'_storage'>
          durationMs: number
          sourceIndex?: number
          audioUrl: string | null
        }>
        totalDurationMs: number
      }>('/api/audio-overview/interject', {
        method: 'POST',
        headers: { 'Idempotency-Key': `interjection_${crypto.randomUUID().replace(/-/g, '')}` },
        body: {
          overviewId: ctx.overviewId,
          insertedAfterTurnIndex: ctx.turnIndex,
          question,
        },
      })

      if (result.schemaVersion === 2 && result.artifactUrl && result.utterances?.length) {
        await audioOverviewStore.playInterjection({
          mediaUrl: result.artifactUrl,
          utterances: result.utterances,
          totalDurationMs: result.totalDurationMs,
          resumeAtMs: ctx.timeMs,
          resumeAfter: playback.resumeAfter,
        })
      }
      else {
        const spliceAt = audioOverviewStore.currentTurnIndex.value
        audioOverviewStore.spliceTurns({
          afterIndex: spliceAt,
          turns: result.turns.map(t => ({
            speaker: t.speaker,
            text: t.text,
            audioFileId: t.audioFileId,
            durationMs: t.durationMs,
            sourceIndex: t.sourceIndex,
          })),
          turnUrls: result.turns.map(t => t.audioUrl),
        })
      }
    }
    catch (err) {
      console.warn('[useChat] Background interjection failed:', err)
      if (playback.pausedContinuousOverview && !audioOverviewStore.isInterjectionActive.value) {
        audioOverviewStore.seek(ctx.timeMs)
        if (playback.resumeAfter) void audioOverviewStore.play()
      }
    }
    finally {
      interjectionInFlight.value = false
    }
  }

  async function loadConversation(conversationIdToLoad: Id<'conversations'>) {
    if (!import.meta.client || !convexClient) return
    const rows = await convexClient.query(api.messages.listByConversation, {
      conversationId: conversationIdToLoad,
    }) as Array<{
      role: 'user' | 'assistant'
      content: string
      sources?: Source[]
      interjectionContext?: InterjectionContext
    }>

    messages.value = rows.map(r => ({
      role: r.role,
      content: r.role === 'assistant' ? normalizeAssistantMessageContent(r.content) : r.content,
      sources: r.sources,
      ...(r.interjectionContext ? { interjectionContext: r.interjectionContext } : {}),
    }))
    currentConversationId.value = conversationIdToLoad
    error.value = null
  }

  function clearMessages() {
    messages.value = []
    error.value = null
  }

  function startNewConversation() {
    currentConversationId.value = null
    clearMessages()
  }

  return {
    messages,
    loading,
    streaming,
    thinking,
    error,
    hasIndexedDocuments,
    selectedModel,
    currentConversationId,
    interjectionInFlight,
    sendMessage,
    selectModel,
    clearMessages,
    loadConversation,
    startNewConversation,
  }
}
