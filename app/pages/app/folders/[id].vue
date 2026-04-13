<script setup lang="ts">
import { FolderPlus, FileText, MessageSquare, Plus, ClipboardList, Layers, ArrowLeftRight, BookOpen } from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'
import { useFolderLayout } from '~/composables/useFolderLayout'
import { api } from '#convex/api'
import type { Id } from '~~/convex/_generated/dataModel'

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
const isTabletOrAbove = useMediaQuery('(min-width: 768px)')

const layout = useFolderLayout(computed(() => folderId.value as string))

const showSubfolderModal = ref(false)
const showEditFolderModal = ref(false)
const showFolderDeleteDialog = ref(false)

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
    layout.openHelper()
  } else if (isTabletOrAbove.value) {
    activeMessageIndex.value = messageIndex
    activeCitationIndex.value = citationIndex - 1
    sourcePanelOpen.value = true
    layout.openHelper()
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

function closeHelper() {
  sourcePanelOpen.value = false
  layout.closeHelper()
}

function toggleHelper() {
  if (layout.helperOpen.value) closeHelper()
  else { sourcePanelOpen.value = true; layout.openHelper() }
}

const subfolders = computed(() => {
  if (!allFolders?.value || !folder.value) return []
  return allFolders.value.filter((f: any) => f.parentId === folder.value?._id)
})

const folderAncestors = computed(() => {
  if (!allFolders?.value || !folder.value) return [] as Array<{ _id: string; name: string }>
  const map = new Map(allFolders.value.map((f: any) => [f._id, f]))
  const chain: Array<{ _id: string; name: string }> = []
  let current = folder.value as any
  const seen = new Set<string>()
  while (current?.parentId) {
    if (seen.has(current.parentId)) break
    seen.add(current.parentId)
    const parent = map.get(current.parentId)
    if (!parent) break
    chain.unshift({ _id: parent._id, name: parent.name })
    current = parent
  }
  return chain
})

const { deleteFolder } = useFolders()

async function confirmDeleteFolder() {
  showFolderDeleteDialog.value = false
  if (!folder.value) return
  try {
    await deleteFolder(folder.value._id as Id<'folders'>)
    const { toast } = await import('vue-sonner')
    toast.success('Folder deleted')
    void router.replace('/app')
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Failed to delete folder')
  }
}

async function handleUpload(files: File[]) {
  try {
    await uploadFiles(files, folderId.value)
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Upload failed')
  }
}
</script>

<template>
  <div data-testid="folder-page" class="flex h-full flex-1 flex-col">
    <FoldersFolderFormModal
      v-model:open="showSubfolderModal"
      mode="create"
      :parent-id="folderId"
    />
    <FoldersFolderFormModal
      v-if="folder"
      v-model:open="showEditFolderModal"
      mode="edit"
      :folder="folder"
    />
    <UiAlertDialog v-model:open="showFolderDeleteDialog">
      <UiAlertDialogContent>
        <UiAlertDialogHeader>
          <UiAlertDialogTitle>Delete folder</UiAlertDialogTitle>
          <UiAlertDialogDescription>
            Delete {{ folder?.name }}? Subfolders and documents inside will be removed.
          </UiAlertDialogDescription>
        </UiAlertDialogHeader>
        <UiAlertDialogFooter>
          <UiAlertDialogCancel>Cancel</UiAlertDialogCancel>
          <UiButton variant="destructive" @click="confirmDeleteFolder">Delete</UiButton>
        </UiAlertDialogFooter>
      </UiAlertDialogContent>
    </UiAlertDialog>

    <UiResizablePanelGroup
      v-if="isDesktop"
      direction="horizontal"
      data-testid="folder-three-pane"
      :data-flipped="layout.flipped.value"
      :data-helper-open="layout.helperOpen.value"
      class="flex-1"
    >
      <UiResizablePanel
        :default-size="layout.paneA.value"
        :min-size="14"
        data-testid="folder-pane-a"
        @resize="(s) => (layout.paneA.value = s)"
      >
        <FoldersFolderContextPane
          :folder="folder"
          :ancestors="folderAncestors"
          :can-create-subfolder="folderDepth < 3"
          @edit="showEditFolderModal = true"
          @delete="showFolderDeleteDialog = true"
          @new-subfolder="showSubfolderModal = true"
        >
          <template #knowledge>
            <FoldersFolderKnowledgeTree
              :subfolders="subfolders"
              :documents="documents ?? []"
              :can-create-subfolder="folderDepth < 3"
              @open-subfolder="(id) => router.push(`/app/folders/${id}`)"
              @new-subfolder="showSubfolderModal = true"
              @upload-files="(files) => uploadFiles(files, folderId)"
              @delete-document="(id) => handleDeleteRequest(id)"
              @move-document="(id) => { moveTarget = { id } }"
            />
          </template>
        </FoldersFolderContextPane>
      </UiResizablePanel>
      <UiResizableHandle with-handle />

      <UiResizablePanel
        :default-size="layout.flipped.value && layout.helperOpen.value ? layout.paneC.value : layout.paneB.value"
        :min-size="20"
        data-testid="folder-pane-mid"
        @resize="(s) => { if (layout.flipped.value && layout.helperOpen.value) layout.paneC.value = s; else layout.paneB.value = s }"
      >
        <template v-if="layout.flipped.value && layout.helperOpen.value">
          <FoldersFolderHelperPane
            :sources="allSources"
            :active-citation-index="activeCitationIndex"
            data-testid="folder-helper-pane-mid"
            @close="closeHelper"
          />
        </template>
        <template v-else>
          <div data-testid="folder-pane-primary" class="flex h-full flex-col p-4">
            <UiTabs v-model="activeTab" class="flex flex-1 flex-col">
      <div class="flex items-center justify-between">
        <UiTabsList>
          <UiTabsTrigger value="chat">
            <MessageSquare class="mr-1.5 h-4 w-4" />
            Chat
          </UiTabsTrigger>
          <!-- UX-DR1 hybrid tab order: Chat, Flash Cards, Quiz, Documents (full order realized in V1.2 via Story 7.1). -->
          <UiTabsTrigger value="flashcards" data-testid="flashcards-tab-trigger">
            <Layers class="mr-1.5 h-4 w-4" />
            Flash Cards
          </UiTabsTrigger>
          <UiTabsTrigger value="quiz" data-testid="quiz-tab-trigger">
            <ClipboardList class="mr-1.5 h-4 w-4" />
            Quiz
          </UiTabsTrigger>
          <UiTabsTrigger value="documents">
            <FileText class="mr-1.5 h-4 w-4" />
            Documents
          </UiTabsTrigger>
        </UiTabsList>
        <div class="flex items-center gap-2">
          <UiButton
            v-if="activeTab === 'chat'"
            variant="outline"
            size="sm"
            data-testid="folder-sources-button"
            :aria-pressed="layout.helperOpen.value"
            @click="toggleHelper"
          >
            <BookOpen class="mr-1.5 h-4 w-4" />
            Sources
          </UiButton>
          <UiButton
            v-if="layout.helperOpen.value"
            variant="ghost"
            size="icon"
            data-testid="folder-flip-toggle"
            aria-label="Flip pane order"
            @click="layout.flip"
          >
            <ArrowLeftRight class="h-4 w-4" />
          </UiButton>
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
        </div>
      </div>

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

        </div>
      </UiTabsContent>

      <UiTabsContent value="flashcards" class="flex-1">
        <FlashcardsTab :folder-id="folderId" />
      </UiTabsContent>

      <UiTabsContent value="quiz" class="flex-1">
        <QuizTab :folder-id="folderId" />
      </UiTabsContent>

      <UiTabsContent value="documents" class="flex-1">
        <DocumentsFileUploadZone
          :folder-id="folderId"
          :disabled="uploading"
          class="mb-6"
          @upload="handleUpload"
        />

        <div v-if="documents && documents.length > 0" class="space-y-2">
          <DocumentsFileStatusItem
            v-for="doc in documents"
            :key="doc._id"
            :filename="doc.filename"
            :status="doc.status"
            :file-size="doc.fileSize"
            :created-at="doc._creationTime"
            :failure-reason="doc.failureReason"
            :document-id="doc._id"
            @delete="handleDeleteRequest"
            @move="handleMoveRequest"
          />
        </div>

        <div
          v-else-if="!documents || documents.length === 0"
          data-testid="folder-empty-state"
          class="flex flex-1 items-center justify-center py-12 text-muted-foreground"
        >
          <div class="text-center">
            <FileText class="mx-auto mb-3 h-12 w-12 opacity-40" />
            <p class="text-lg font-medium">Documents will appear here</p>
            <p class="mt-1 text-sm">Upload files to get started</p>
          </div>
        </div>
      </UiTabsContent>
    </UiTabs>
          </div>
        </template>
      </UiResizablePanel>

      <template v-if="layout.helperOpen.value && !layout.flipped.value">
        <UiResizableHandle with-handle />
        <UiResizablePanel
          :default-size="layout.paneC.value"
          :min-size="20"
          data-testid="folder-pane-c"
          @resize="(s) => (layout.paneC.value = s)"
        >
          <FoldersFolderHelperPane
            :sources="allSources"
            :active-citation-index="activeCitationIndex"
            data-testid="folder-helper-pane-end"
            @close="closeHelper"
          />
        </UiResizablePanel>
      </template>

      <template v-if="layout.helperOpen.value && layout.flipped.value">
        <UiResizableHandle with-handle />
        <UiResizablePanel
          :default-size="layout.paneB.value"
          :min-size="20"
          data-testid="folder-pane-c"
          @resize="(s) => (layout.paneB.value = s)"
        >
          <div class="flex h-full flex-col p-4">
            <UiTabs v-model="activeTab" class="flex flex-1 flex-col">
              <div class="flex items-center justify-between">
                <UiTabsList>
                  <UiTabsTrigger value="chat">
                    <MessageSquare class="mr-1.5 h-4 w-4" />
                    Chat
                  </UiTabsTrigger>
                  <UiTabsTrigger value="flashcards">
                    <Layers class="mr-1.5 h-4 w-4" />
                    Flash Cards
                  </UiTabsTrigger>
                  <UiTabsTrigger value="quiz">
                    <ClipboardList class="mr-1.5 h-4 w-4" />
                    Quiz
                  </UiTabsTrigger>
                  <UiTabsTrigger value="documents">
                    <FileText class="mr-1.5 h-4 w-4" />
                    Documents
                  </UiTabsTrigger>
                </UiTabsList>
                <div class="flex items-center gap-2">
                  <UiButton
                    variant="outline"
                    size="sm"
                    :aria-pressed="layout.helperOpen.value"
                    @click="toggleHelper"
                  >
                    <BookOpen class="mr-1.5 h-4 w-4" />
                    Sources
                  </UiButton>
                  <UiButton
                    variant="ghost"
                    size="icon"
                    aria-label="Flip pane order"
                    @click="layout.flip"
                  >
                    <ArrowLeftRight class="h-4 w-4" />
                  </UiButton>
                </div>
              </div>
              <UiTabsContent value="chat" class="flex flex-1 flex-col overflow-hidden">
                <div class="flex flex-1 flex-col overflow-hidden">
                  <div ref="chatScrollRef" role="log" aria-live="polite" class="flex-1 space-y-4 overflow-y-auto p-4">
                    <ChatMessage
                      v-for="(msg, i) in messages"
                      :key="i"
                      :role="msg.role"
                      :content="msg.content"
                      :sources="msg.sources"
                      :streaming="streaming && i === messages.length - 1"
                      @citation-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                    />
                  </div>
                  <ChatInput
                    ref="chatInputRef"
                    :disabled="!hasIndexedDocuments || loading"
                    :placeholder="folder ? `Ask about your ${folder.name} materials...` : 'Ask a question...'"
                    @submit="handleSendMessage"
                  />
                </div>
              </UiTabsContent>
            </UiTabs>
          </div>
        </UiResizablePanel>
      </template>
    </UiResizablePanelGroup>

    <div v-else class="flex flex-1 flex-col p-6">
      <div class="mb-6 flex items-center justify-between">
        <UiSkeleton v-if="!folder" class="h-8 w-48 rounded-md" />
        <h1 v-else data-testid="folder-heading" class="text-2xl font-bold tracking-tight">
          {{ folder.name }}
        </h1>
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
      <UiTabs v-model="activeTab" class="flex flex-1 flex-col">
        <UiTabsList>
          <UiTabsTrigger value="chat">
            <MessageSquare class="mr-1.5 h-4 w-4" />
            Chat
          </UiTabsTrigger>
          <UiTabsTrigger value="flashcards" data-testid="flashcards-tab-trigger">
            <Layers class="mr-1.5 h-4 w-4" />
            Flash Cards
          </UiTabsTrigger>
          <UiTabsTrigger value="quiz" data-testid="quiz-tab-trigger">
            <ClipboardList class="mr-1.5 h-4 w-4" />
            Quiz
          </UiTabsTrigger>
          <UiTabsTrigger value="documents">
            <FileText class="mr-1.5 h-4 w-4" />
            Documents
          </UiTabsTrigger>
        </UiTabsList>
        <UiTabsContent value="chat" class="flex flex-1 flex-col overflow-hidden">
          <div class="flex flex-1 flex-col overflow-hidden">
            <div ref="chatScrollRef" role="log" aria-live="polite" class="flex-1 space-y-4 overflow-y-auto p-4">
              <template v-for="(msg, i) in messages" :key="i">
                <ChatMessage
                  :role="msg.role"
                  :content="msg.content"
                  :sources="msg.sources"
                  :streaming="streaming && i === messages.length - 1"
                  @citation-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                />
                <template v-if="expandedInlineCitation?.messageIndex === i">
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
            </div>
            <ChatInput
              ref="chatInputRef"
              :disabled="!hasIndexedDocuments || loading"
              :placeholder="folder ? `Ask about your ${folder.name} materials...` : 'Ask a question...'"
              @submit="handleSendMessage"
            />
          </div>
        </UiTabsContent>
        <UiTabsContent value="flashcards" class="flex-1">
          <FlashcardsTab :folder-id="folderId" />
        </UiTabsContent>
        <UiTabsContent value="quiz" class="flex-1">
          <QuizTab :folder-id="folderId" />
        </UiTabsContent>
        <UiTabsContent value="documents" class="flex-1">
          <DocumentsFileUploadZone
            :folder-id="folderId"
            :disabled="uploading"
            class="mb-6"
            @upload="handleUpload"
          />
          <div v-if="documents && documents.length > 0" class="space-y-2">
            <DocumentsFileStatusItem
              v-for="doc in documents"
              :key="doc._id"
              :filename="doc.filename"
              :status="doc.status"
              :file-size="doc.fileSize"
              :created-at="doc._creationTime"
              :failure-reason="doc.failureReason"
              :document-id="doc._id"
              @delete="handleDeleteRequest"
              @move="handleMoveRequest"
            />
          </div>
          <div
            v-else-if="!documents || documents.length === 0"
            data-testid="folder-empty-state"
            class="flex flex-1 items-center justify-center py-12 text-muted-foreground"
          >
            <div class="text-center">
              <FileText class="mx-auto mb-3 h-12 w-12 opacity-40" />
              <p class="text-lg font-medium">Documents will appear here</p>
              <p class="mt-1 text-sm">Upload files to get started</p>
            </div>
          </div>
        </UiTabsContent>
      </UiTabs>
    </div>

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
  </div>
</template>
