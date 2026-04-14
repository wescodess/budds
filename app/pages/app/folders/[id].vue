<script setup lang="ts">
import { FolderPlus, FileText, MessageSquare, Plus, ClipboardList, Layers, PanelRight } from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'
import { api } from '#convex/api'
import type { Id } from '~~/convex/_generated/dataModel'
import type { VoidType } from '~/components/voids/CreateVoidDialog.vue'

definePageMeta({ layout: 'folder' })

const route = useRoute()
const router = useRouter()
const folderId = computed(() => route.params.id as Id<'folders'>)
const conversationIdRef = computed<Id<'conversations'> | null>(() => {
  const q = route.query?.conversationId
  if (!q || Array.isArray(q)) return null
  return q as Id<'conversations'>
})

const { folder } = useFolderDetail(folderId)
const { allFolders } = useFolders()
const { documents, uploading, uploadFiles, deleteDocument, moveDocument } = useDocuments(folderId)
const {
  messages,
  loading,
  streaming,
  error,
  hasIndexedDocuments,
  selectedModel,
  sendMessage,
  selectModel,
  loadConversation,
  startNewConversation,
} = useChat(folderId, conversationIdRef)

const isDesktop = useMediaQuery('(min-width: 1024px)')

const showSubfolderModal = ref(false)
const newVoidOpen = ref(false)
const creatingVoid = ref(false)

const createConversationMutation = import.meta.client
  ? useConvexMutation(api.conversations.createConversation)
  : {
      mutate: async (_args: { folderId: Id<'folders'>; title: string }) =>
        '' as unknown as Id<'conversations'>,
    }

function unwrapConvexError(err: any): string {
  if (err?.data?.message && typeof err.data.message === 'string') return err.data.message
  const raw = typeof err?.message === 'string' ? err.message : ''
  return raw.replace(/^\[CONVEX [^\]]+\]\s*/, '').replace(/^ConvexError:\s*/, '').trim()
}

async function onCreateVoid(type: VoidType) {
  if (creatingVoid.value) return
  creatingVoid.value = true
  try {
    if (type === 'chat') {
      const newId = (await createConversationMutation.mutate({
        folderId: folderId.value,
        title: 'New chat',
      })) as Id<'conversations'>
      activeTab.value = 'chat'
      void router.replace({ query: { ...(route.query ?? {}), tab: 'chat', conversationId: newId } })
    } else {
      activeTab.value = type
      void router.replace({ query: { ...(route.query ?? {}), tab: type } })
    }
    newVoidOpen.value = false
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(unwrapConvexError(e) || 'Failed to create void')
  } finally {
    creatingVoid.value = false
  }
}

function onSelectVoid({ type, id }: { type: 'chat' | 'flashcards' | 'quiz'; id: string }) {
  activeTab.value = type
  const base = { ...(route.query ?? {}) }
  if (type === 'chat') {
    void router.replace({ query: { ...base, tab: 'chat', conversationId: id } })
  } else {
    const { conversationId: _dropped, ...rest } = base
    void router.replace({ query: { ...rest, tab: type } })
  }
}

const deleteTarget = ref<{ id: string; filename: string } | null>(null)
const pendingDeleteTarget = ref<{ id: string; filename: string } | null>(null)
const showDeleteDialog = ref(false)

const moveTarget = ref<{ id: string } | null>(null)
const movePending = ref(false)
const showMoveDialog = computed({
  get: () => moveTarget.value !== null,
  set: (val: boolean) => { if (!val) moveTarget.value = null },
})

const allowedTabs = ['chat', 'flashcards', 'quiz', 'documents'] as const
type TabValue = typeof allowedTabs[number]
const initialTab = computed<TabValue>(() => {
  const t = route.query?.tab
  return typeof t === 'string' && (allowedTabs as readonly string[]).includes(t) ? (t as TabValue) : 'chat'
})
const activeTab = ref<TabValue>(initialTab.value)

watch(() => route.query?.tab, () => {
  activeTab.value = initialTab.value
})

function onTabChange(next: TabValue) {
  activeTab.value = next
  void router.replace({ query: { ...(route.query ?? {}), tab: next } })
}
const sourcePanelOpen = ref(false)
const activeCitationIndex = ref<number | null>(null)
const activeMessageIndex = ref<number | null>(null)
const expandedInlineCitation = ref<{ messageIndex: number; citationIndex: number } | null>(null)
const chatInputRef = ref<{ focus: () => void } | null>(null)
const chatScrollRef = ref<HTMLElement | null>(null)

const allSources = computed(() => {
  if (activeMessageIndex.value === null) return []
  const msg = messages.value[activeMessageIndex.value]
  return msg?.sources ?? []
})

function handleCitationClick(messageIndex: number, citationIndex: number) {
  if (isDesktop.value) {
    activeMessageIndex.value = messageIndex
    activeCitationIndex.value = citationIndex - 1
    sourcePanelOpen.value = true
  } else {
    const same = expandedInlineCitation.value?.messageIndex === messageIndex
      && expandedInlineCitation.value?.citationIndex === citationIndex
    expandedInlineCitation.value = same ? null : { messageIndex, citationIndex }
  }
}

function getSourceForInlineCitation(messageIndex: number, citationIndex: number) {
  const msg = messages.value[messageIndex]
  return msg?.sources?.[citationIndex - 1]
}

watch(() => messages.value.length, () => {
  nextTick(() => {
    chatScrollRef.value?.scrollTo({ top: chatScrollRef.value.scrollHeight, behavior: 'smooth' })
  })
})

watch(
  () => messages.value[messages.value.length - 1]?.content.length,
  () => {
    if (streaming.value) {
      nextTick(() => {
        chatScrollRef.value?.scrollTo({ top: chatScrollRef.value.scrollHeight, behavior: 'auto' })
      })
    }
  },
)

function handleSlashShortcut(e: KeyboardEvent) {
  if (e.key !== '/' || activeTab.value !== 'chat') return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  e.preventDefault()
  chatInputRef.value?.focus()
}

function handleNewChatShortcut(e: KeyboardEvent) {
  if (e.key.toLowerCase() !== 'n' || !(e.ctrlKey || e.metaKey)) return
  if (activeTab.value !== 'chat') return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  e.preventDefault()
  handleNewChat()
}

function handleNewChat() {
  startNewConversation()
  const { conversationId: _dropped, ...rest } = route.query ?? {}
  void router.replace({ query: rest })
}

async function hydrateFromRoute() {
  if (!import.meta.client) return
  if (conversationIdRef.value) {
    try {
      await loadConversation(conversationIdRef.value)
    } catch {
      // conversation may not exist; ignore
    }
    return
  }

  try {
    const client = useConvex()
    const convo = await client.query(api.conversations.getMostRecentForFolder, {
      folderId: folderId.value,
    })
    if (convo?._id) {
      await loadConversation(convo._id as Id<'conversations'>)
      void router.replace({ query: { ...route.query, conversationId: convo._id } })
    }
  } catch {
    // best-effort hydration
  }
}

watch(folderId, () => {
  startNewConversation()
  void hydrateFromRoute()
})

watch(conversationIdRef, async (next, prev) => {
  if (next === prev) return
  if (next) {
    try {
      await loadConversation(next)
    } catch {
      // ignore
    }
  } else {
    startNewConversation()
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleSlashShortcut)
  document.addEventListener('keydown', handleNewChatShortcut)
  void hydrateFromRoute()
  const promptParam = route.query?.prompt
  if (typeof promptParam === 'string' && promptParam.trim()) {
    nextTick(() => chatInputRef.value?.focus())
    const { prompt: _drop, ...rest } = route.query ?? {}
    void router.replace({ query: rest })
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleSlashShortcut)
  document.removeEventListener('keydown', handleNewChatShortcut)
})

async function handleSendMessage(query: string) {
  expandedInlineCitation.value = null
  activeMessageIndex.value = null
  await sendMessage(query)
}

async function handleDeleteRequest(docId: string) {
  const doc = documents.value?.find((d) => d._id === docId)
  if (!doc) return

  if (doc.status === 'failed') {
    try {
      await deleteDocument(docId as Id<'documents'>)
    } catch (e: any) {
      const { toast } = await import('vue-sonner')
      toast.error(e.message || 'Failed to remove document')
    }
    return
  }

  deleteTarget.value = { id: docId, filename: doc.filename }
  pendingDeleteTarget.value = { id: docId, filename: doc.filename }
  showDeleteDialog.value = true
}

async function confirmDelete() {
  const target = pendingDeleteTarget.value
  showDeleteDialog.value = false
  deleteTarget.value = null
  pendingDeleteTarget.value = null
  if (!target) return
  try {
    await deleteDocument(target.id as Id<'documents'>)
    const { toast } = await import('vue-sonner')
    toast.success('Document deleted')
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Failed to delete document')
  }
}

function handleMoveRequest(docId: string) {
  moveTarget.value = { id: docId }
}

async function confirmMove(destFolderId: Id<'folders'>) {
  if (!moveTarget.value || movePending.value) return
  movePending.value = true
  try {
    await moveDocument(moveTarget.value.id as Id<'documents'>, destFolderId)
    const destFolder = allFolders.value?.find((f) => f._id === destFolderId)
    const { toast } = await import('vue-sonner')
    toast.success(`Moved to ${destFolder?.name ?? 'folder'}`)
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Failed to move document')
  } finally {
    movePending.value = false
    moveTarget.value = null
  }
}

const folderDepth = computed(() => {
  if (!allFolders?.value || !folderId.value) return 1
  let depth = 1
  let currentId = folderId.value as string
  const folderMap = new Map(allFolders.value.map((f: any) => [f._id, f]))
  const seen = new Set<string>()
  let current = folderMap.get(currentId)
  while (current?.parentId) {
    if (seen.has(current.parentId)) break
    seen.add(current.parentId)
    depth++
    current = folderMap.get(current.parentId)
  }
  return depth
})

async function handleUpload(files: File[]) {
  try {
    await uploadFiles(files, folderId.value)
    const { toast } = await import('vue-sonner')
    toast.success(files.length === 1 ? 'Document uploaded' : `${files.length} documents uploaded`)
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Upload failed')
  }
}
</script>

<template>
  <FolderShell
    :folder-id="folderId"
    :folder="folder ?? null"
    :active-tab="activeTab"
    :active-conversation-id="conversationIdRef ? (conversationIdRef as unknown as string) : null"
    @update:active-tab="onTabChange"
    @new-void="newVoidOpen = true"
    @select-void="onSelectVoid"
  >
    <template #top-bar="{ drawerOpen, toggleDrawer }">
      <div class="flex items-center justify-between gap-3 border-b border-border/60 px-6 py-4">
        <div class="flex min-w-0 items-center gap-3">
          <button
            type="button"
            data-testid="drawer-toggle"
            :class="[
              'flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card text-primary transition hover:bg-primary/10',
              drawerOpen && 'bg-primary/10',
            ]"
            :aria-label="drawerOpen ? 'Close folder tree' : 'Open folder tree'"
            @click="toggleDrawer"
          >
            <PanelRight class="h-4 w-4" />
          </button>
          <div class="min-w-0">
            <UiSkeleton v-if="!folder" class="h-6 w-40 rounded-md" />
            <h1 v-else data-testid="folder-heading" class="truncate text-xl font-semibold tracking-tight text-foreground">
              {{ folder.name }}
            </h1>
            <p class="text-xs text-muted-foreground">My folder › {{ folder?.name ?? '…' }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <UiButton
            v-if="activeTab === 'chat'"
            variant="outline"
            size="sm"
            data-testid="chat-new-button"
            @click="handleNewChat"
          >
            <Plus class="mr-1.5 h-4 w-4" />
            New Chat
          </UiButton>
          <UiButton
            v-if="folderDepth < 3"
            variant="outline"
            size="sm"
            data-testid="new-subfolder-button"
            @click="showSubfolderModal = true"
          >
            <FolderPlus class="mr-1.5 h-4 w-4" />
            New Subfolder
          </UiButton>
        </div>
      </div>
    </template>

    <FoldersFolderFormModal
      v-model:open="showSubfolderModal"
      mode="create"
      :parent-id="folderId"
    />

    <VoidsCreateVoidDialog
      v-model:open="newVoidOpen"
      :folder-name="folder?.name ?? ''"
      :submitting="creatingVoid"
      @create="onCreateVoid"
    />

    <UiTabs v-model="activeTab" class="flex h-full flex-1 flex-col">
      <UiTabsList class="sr-only">
        <UiTabsTrigger value="chat">Chat</UiTabsTrigger>
        <UiTabsTrigger value="flashcards">Flash Cards</UiTabsTrigger>
        <UiTabsTrigger value="quiz">Quiz</UiTabsTrigger>
        <UiTabsTrigger value="documents">Documents</UiTabsTrigger>
      </UiTabsList>

      <UiTabsContent value="chat" class="flex flex-1 flex-col overflow-hidden">
        <div class="flex flex-1 overflow-hidden">
          <div class="flex flex-1 flex-col overflow-hidden">
            <template v-if="!hasIndexedDocuments">
              <div class="flex flex-1 items-center justify-center text-muted-foreground">
                <div class="text-center">
                  <FileText class="mx-auto mb-3 h-12 w-12 opacity-40" />
                  <p class="text-lg font-medium">Upload documents to start chatting</p>
                </div>
              </div>
            </template>

            <template v-else>
              <div ref="chatScrollRef" role="log" aria-live="polite" aria-atomic="false" aria-relevant="additions" class="flex-1 space-y-4 overflow-y-auto p-4">
                <template v-for="(msg, i) in messages" :key="i">
                  <ChatMessage
                    :role="msg.role"
                    :content="msg.content"
                    :sources="msg.sources"
                    :streaming="streaming && i === messages.length - 1"
                    @citation-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                  />
                  <template v-if="!isDesktop && expandedInlineCitation?.messageIndex === i">
                    <div
                      v-for="src in [getSourceForInlineCitation(i, expandedInlineCitation.citationIndex)].filter(Boolean)"
                      :key="expandedInlineCitation.citationIndex"
                      class="mx-auto max-w-[85%] rounded-lg border bg-muted/50 p-3"
                    >
                      <ChatSourceCard
                        :index="expandedInlineCitation.citationIndex"
                        :filename="src!.filename"
                        :content="src!.content"
                        :score="src!.score"
                        highlighted
                      />
                    </div>
                  </template>
                </template>
                <div v-if="loading && !streaming" class="mr-auto max-w-[85%] rounded-lg border px-4 py-3">
                  <div class="flex items-center gap-2 text-sm text-muted-foreground">
                    <div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Thinking...
                  </div>
                </div>
                <div v-if="error" class="text-center text-sm text-destructive">
                  {{ error }}
                </div>
              </div>
            </template>

            <div class="flex items-center px-4 pt-2">
              <ChatModelSelector
                :model-value="selectedModel"
                :disabled="loading"
                @update:model-value="selectModel"
              />
            </div>
            <ChatInput
              ref="chatInputRef"
              :disabled="!hasIndexedDocuments || loading"
              :placeholder="folder ? `Ask about your ${folder.name} materials...` : 'Ask a question...'"
              @submit="handleSendMessage"
            />
          </div>

          <ChatSourcePanel
            v-if="isDesktop"
            :sources="allSources"
            :active-citation-index="activeCitationIndex"
            :open="sourcePanelOpen"
            @close="sourcePanelOpen = false"
          />
        </div>
      </UiTabsContent>

      <UiTabsContent value="flashcards" class="flex-1">
        <FlashcardsTab :folder-id="folderId" />
      </UiTabsContent>

      <UiTabsContent value="quiz" class="flex-1">
        <QuizTab :folder-id="folderId" />
      </UiTabsContent>

      <UiTabsContent value="documents" class="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
        <DocumentsFileUploadZone
          :folder-id="folderId"
          :disabled="uploading"
          @upload="handleUpload"
        />
        <FolderShellFilesList
          :documents="documents"
          @delete="handleDeleteRequest"
          @move="handleMoveRequest"
          @open="() => undefined"
          @rename="() => undefined"
          @download="() => undefined"
        />
      </UiTabsContent>
    </UiTabs>

    <UiAlertDialog v-model:open="showDeleteDialog">
      <UiAlertDialogContent>
        <UiAlertDialogHeader>
          <UiAlertDialogTitle>Delete document</UiAlertDialogTitle>
          <UiAlertDialogDescription>
            Are you sure you want to delete {{ deleteTarget?.filename }}? This will remove the document and its indexed content.
          </UiAlertDialogDescription>
        </UiAlertDialogHeader>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel>Cancel</UiAlertDialogCancel>
          <UiButton variant="destructive" @click="confirmDelete">Delete</UiButton>
        </UiAlertDialogFooter>
      </UiAlertDialogContent>
    </UiAlertDialog>

    <UiDialog v-model:open="showMoveDialog">
      <UiDialogContent>
        <UiDialogHeader>
          <UiDialogTitle>Move to folder</UiDialogTitle>
          <UiDialogDescription>Choose a destination folder.</UiDialogDescription>
        </UiDialogHeader>
        <div class="max-h-64 space-y-1 overflow-y-auto py-2">
          <button
            v-for="f in allFolders"
            :key="f._id"
            :disabled="f._id === folderId || movePending"
            class="flex w-full items-center rounded-md px-3 py-2 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            @click="confirmMove(f._id)"
          >
            {{ f.name }}
          </button>
        </div>
      </UiDialogContent>
    </UiDialog>
  </FolderShell>
</template>
