<script setup lang="ts">
import type { Id } from '~~/convex/_generated/dataModel'
import type { InterjectionContext } from '~/composables/useChat'
import { injectFolderContext } from '~/composables/useFolderPageContext'

const route = useRoute()
const ctx = injectFolderContext()
const { folderId, referenceScope, helperPane } = ctx

const conversationIdRef = computed<Id<'conversations'> | null>(() => {
  const id = route.params.conversationId
  if (!id || Array.isArray(id)) return null
  return id as Id<'conversations'>
})

const {
  messages, loading, streaming, thinking, error,
  hasIndexedDocuments, selectedModel, interjectionInFlight,
  sendMessage, selectModel, loadConversation, startNewConversation,
} = useChat(folderId, conversationIdRef)

const workspaceRef = ref<{ focus: () => void } | null>(null)

watch(conversationIdRef, async (next, prev) => {
  if (next === prev) return
  if (next) {
    try { await loadConversation(next) } catch {}
  } else {
    startNewConversation()
  }
}, { immediate: true })

function handleNewChat() {
  startNewConversation()
  navigateTo(`/app/folders/${folderId.value}/chat`)
}

async function handleSendMessage(query: string) {
  await sendMessage(query, referenceScope.toPayload())
}

async function handlePodcastAskSubmit(payload: { question: string, context: InterjectionContext }) {
  await sendMessage(payload.question, referenceScope.toPayload(), payload.context)
}

function handleInterjectionBadgeClick(intCtx: InterjectionContext) {
  const store = useAudioOverviewStore()
  store.seek(intCtx.timeMs)
  helperPane.open('podcast')
}

function handleTaskViewRoom(roomId: string) {
  helperPane.close()
  navigateTo(`/app/folders/${folderId.value}/flashcards/${roomId}`)
}

function handleSlashShortcut(e: KeyboardEvent) {
  if (e.key !== '/') return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  e.preventDefault()
  workspaceRef.value?.focus()
}

function handleNewChatShortcut(e: KeyboardEvent) {
  if (e.key.toLowerCase() !== 'n' || !(e.ctrlKey || e.metaKey)) return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  e.preventDefault()
  handleNewChat()
}

onMounted(() => {
  document.addEventListener('keydown', handleSlashShortcut)
  document.addEventListener('keydown', handleNewChatShortcut)
  const promptParam = route.query?.prompt
  if (typeof promptParam === 'string' && promptParam.trim()) {
    nextTick(() => workspaceRef.value?.focus())
    const { prompt: _drop, ...rest } = route.query ?? {}
    void useRouter().replace({ query: rest })
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleSlashShortcut)
  document.removeEventListener('keydown', handleNewChatShortcut)
})
</script>

<template>
  <ChatWorkspace
    ref="workspaceRef"
    :messages="messages"
    :loading="loading"
    :streaming="streaming"
    :thinking="thinking"
    :error="error"
    :has-indexed-documents="hasIndexedDocuments"
    :selected-model="selectedModel"
    :interjection-in-flight="interjectionInFlight"
    :conversation-id="conversationIdRef"
    @send="handleSendMessage"
    @select-model="selectModel"
    @interjection-badge-click="handleInterjectionBadgeClick"
    @podcast-ask-submit="handlePodcastAskSubmit"
    @task-view-room="handleTaskViewRoom"
  />
</template>
