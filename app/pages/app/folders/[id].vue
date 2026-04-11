<script setup lang="ts">
import { FolderPlus, FileText, MessageSquare } from 'lucide-vue-next'
import { useMediaQuery } from '@vueuse/core'
import type { Id } from '~~/convex/_generated/dataModel'

const route = useRoute()
const folderId = computed(() => route.params.id as Id<'folders'>)

const { folder } = useFolderDetail(folderId)
const { allFolders, createSubfolder } = useFolders()
const { documents, uploading, uploadFiles, deleteDocument, moveDocument } = useDocuments(folderId)
const { messages, loading, error, hasIndexedDocuments, sendMessage } = useChat(folderId)

const isDesktop = useMediaQuery('(min-width: 1024px)')

const showNewSubfolder = ref(false)
const newSubfolderName = ref('')

const deleteTarget = ref<{ id: string; filename: string } | null>(null)
const pendingDeleteTarget = ref<{ id: string; filename: string } | null>(null)
const showDeleteDialog = ref(false)

const moveTarget = ref<{ id: string } | null>(null)
const movePending = ref(false)
const showMoveDialog = computed({
  get: () => moveTarget.value !== null,
  set: (val: boolean) => { if (!val) moveTarget.value = null },
})

const activeTab = ref('chat')
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

function handleSlashShortcut(e: KeyboardEvent) {
  if (e.key !== '/' || activeTab.value !== 'chat') return
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
  e.preventDefault()
  chatInputRef.value?.focus()
}

onMounted(() => {
  document.addEventListener('keydown', handleSlashShortcut)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleSlashShortcut)
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

async function handleCreateSubfolder() {
  const name = newSubfolderName.value.trim()
  if (!name) return
  try {
    await createSubfolder(name, folderId.value)
    newSubfolderName.value = ''
    showNewSubfolder.value = false
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Failed to create subfolder')
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
  <div class="flex flex-1 flex-col p-6">
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
        @click="showNewSubfolder = !showNewSubfolder"
      >
        <FolderPlus class="mr-1.5 h-4 w-4" />
        New Subfolder
      </UiButton>
    </div>

    <div v-if="showNewSubfolder" class="mb-4 max-w-sm">
      <UiInput
        v-model="newSubfolderName"
        placeholder="Subfolder name"
        class="h-8 text-sm"
        @keydown.enter="handleCreateSubfolder"
        @keydown.escape="showNewSubfolder = false"
      />
    </div>

    <UiTabs v-model="activeTab" class="flex flex-1 flex-col">
      <UiTabsList>
        <UiTabsTrigger value="chat">
          <MessageSquare class="mr-1.5 h-4 w-4" />
          Chat
        </UiTabsTrigger>
        <UiTabsTrigger value="documents">
          <FileText class="mr-1.5 h-4 w-4" />
          Documents
        </UiTabsTrigger>
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
              <div ref="chatScrollRef" role="log" class="flex-1 space-y-4 overflow-y-auto p-4">
                <template v-for="(msg, i) in messages" :key="i">
                  <ChatChatMessage
                    :role="msg.role"
                    :content="msg.content"
                    :sources="msg.sources"
                    @citation-click="(citIndex: number) => handleCitationClick(i, citIndex)"
                  />
                  <div
                    v-if="!isDesktop && expandedInlineCitation?.messageIndex === i && getSourceForInlineCitation(i, expandedInlineCitation.citationIndex)"
                    class="mx-auto max-w-[85%] rounded-lg border bg-muted/50 p-3"
                  >
                    <ChatSourceCard
                      :index="expandedInlineCitation.citationIndex"
                      :filename="getSourceForInlineCitation(i, expandedInlineCitation.citationIndex)!.filename"
                      :content="getSourceForInlineCitation(i, expandedInlineCitation.citationIndex)!.content"
                      :score="getSourceForInlineCitation(i, expandedInlineCitation.citationIndex)!.score"
                      highlighted
                    />
                  </div>
                </template>
                <div v-if="loading" class="mr-auto max-w-[85%] rounded-lg border px-4 py-3">
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

            <ChatChatInput
              ref="chatInputRef"
              :disabled="!hasIndexedDocuments"
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
