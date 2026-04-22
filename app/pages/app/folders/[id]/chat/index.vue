<script setup lang="ts">
import { api } from '#convex/api'
import type { Id } from '~~/convex/_generated/dataModel'
import type { InterjectionContext } from '~/composables/useChat'
import { injectFolderContext } from '~/composables/useFolderPageContext'

const ctx = injectFolderContext()
const { folderId, referenceScope, helperPane } = ctx

const conversationIdRef = ref<Id<'conversations'> | null>(null)

const {
  messages, loading, streaming, thinking, error,
  hasIndexedDocuments, selectedModel, interjectionInFlight,
  sendMessage, selectModel, loadConversation, startNewConversation,
} = useChat(folderId, conversationIdRef)

const workspaceRef = ref<{ focus: () => void } | null>(null)

async function hydrateFromMostRecent() {
  if (!import.meta.client) return
  try {
    const client = useConvex()
    const convo = await client.query(api.conversations.getMostRecentForFolder, {
      folderId: folderId.value,
    })
    if (convo?._id) {
      conversationIdRef.value = convo._id as Id<'conversations'>
      await loadConversation(convo._id as Id<'conversations'>)
    }
  } catch {}
}

onMounted(() => {
  void hydrateFromMostRecent()
  document.addEventListener('keydown', handleSlashShortcut)
  document.addEventListener('keydown', handleNewChatShortcut)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleSlashShortcut)
  document.removeEventListener('keydown', handleNewChatShortcut)
})

async function handleSendMessage(query: string) {
  await sendMessage(query, referenceScope.toPayload())
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
  startNewConversation()
  conversationIdRef.value = null
}
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
    @send="handleSendMessage"
    @select-model="selectModel"
    @interjection-badge-click="handleInterjectionBadgeClick"
    @task-view-room="handleTaskViewRoom"
  />
</template>
