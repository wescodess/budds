<script setup lang="ts">
import type { Id } from '~~/convex/_generated/dataModel'
import { injectFolderContext } from '~/composables/useFolderPageContext'

const ctx = injectFolderContext()
const {
  folderId, documents, documentsForDisplay, dismissDisplayDocument,
  isDesktop, uploading, handleUpload,
  requestDeleteDocuments, requestMoveDocuments,
} = ctx

const documentsBulkMode = ref(false)
const selectedDocumentIds = ref<string[]>([])
const documentsDeletePending = ref(false)
const movePending = ref(false)

function clearSelectedDocuments() {
  selectedDocumentIds.value = []
}

function exitDocumentsBulkMode() {
  documentsBulkMode.value = false
  clearSelectedDocuments()
}

function toggleDocumentsBulkMode(next: boolean) {
  if (!next) { exitDocumentsBulkMode(); return }
  if ((documentsForDisplay.value?.length ?? 0) === 0) return
  documentsBulkMode.value = true
}

function toggleDocumentSelection(id: string) {
  if (!documentsBulkMode.value) documentsBulkMode.value = true
  const next = new Set(selectedDocumentIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedDocumentIds.value = [...next]
}

function selectAllVisibleDocuments() {
  selectedDocumentIds.value = (documentsForDisplay.value ?? [])
    .filter(doc => doc.status !== 'pending' && doc.status !== 'failed')
    .map(doc => String(doc._id))
}

watch(
  () => (documentsForDisplay.value ?? []).map(doc => String(doc._id)),
  (visibleIds) => {
    const visible = new Set(visibleIds)
    const next = selectedDocumentIds.value.filter(id => visible.has(id))
    if (next.length !== selectedDocumentIds.value.length) selectedDocumentIds.value = next
    if (visibleIds.length === 0 && documentsBulkMode.value) exitDocumentsBulkMode()
  },
  { immediate: true },
)

function handleDeleteRequest(docId: string) {
  const doc = documents.value?.find((d) => d._id === docId)
  if (!doc) return
  if (doc.status === 'failed') {
    ctx.deleteDocument(docId as Id<'documents'>).catch(async (e: any) => {
      const { toast } = await import('vue-sonner')
      toast.error(e.message || 'Failed to remove document')
    })
    return
  }
  requestDeleteDocuments([docId])
}

function handleDeleteSelectedDocuments() {
  if (selectedDocumentIds.value.length === 0) return
  requestDeleteDocuments([...selectedDocumentIds.value])
}

function handleMoveRequest(docId: string) {
  requestMoveDocuments([docId])
}

function handleMoveSelectedDocuments() {
  if (selectedDocumentIds.value.length === 0) return
  requestMoveDocuments([...selectedDocumentIds.value])
}
</script>

<template>
  <div class="keyboard-scroll-area flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6">
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <DocumentsFileUploadZone
        :folder-id="folderId"
        :disabled="uploading"
        @upload="handleUpload"
      />
      <FolderShellFilesPanel
        v-if="!isDesktop"
        :documents="documentsForDisplay"
        :bulk-mode="documentsBulkMode"
        :selected-ids="selectedDocumentIds"
        :pending="documentsDeletePending || movePending"
        @delete="handleDeleteRequest"
        @dismiss="dismissDisplayDocument"
        @move="handleMoveRequest"
        @open="() => undefined"
        @rename="() => undefined"
        @download="() => undefined"
        @toggle-bulk-mode="toggleDocumentsBulkMode"
        @select-all="selectAllVisibleDocuments"
        @clear-selection="clearSelectedDocuments"
        @bulk-move="handleMoveSelectedDocuments"
        @bulk-delete="handleDeleteSelectedDocuments"
        @toggle-select="toggleDocumentSelection"
      />
      <FolderShellFilesList
        v-else
        :documents="documentsForDisplay"
        @delete="handleDeleteRequest"
        @dismiss="dismissDisplayDocument"
        @move="handleMoveRequest"
        @open="() => undefined"
        @rename="() => undefined"
        @download="() => undefined"
      />
    </div>
  </div>
</template>
