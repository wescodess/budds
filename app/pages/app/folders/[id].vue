<script setup lang="ts">
import { FolderPlus, FileText } from 'lucide-vue-next'
import type { Id } from '~~/convex/_generated/dataModel'

const route = useRoute()
const folderId = computed(() => route.params.id as Id<'folders'>)

const { folder } = useFolderDetail(folderId)
const { allFolders, createSubfolder } = useFolders()
const { documents, uploading, uploadFiles, deleteDocument, moveDocument } = useDocuments(folderId)

const showNewSubfolder = ref(false)
const newSubfolderName = ref('')

const deleteTarget = ref<{ id: string; filename: string } | null>(null)
const showDeleteDialog = computed({
  get: () => deleteTarget.value !== null,
  set: (val: boolean) => { if (!val) deleteTarget.value = null },
})

const moveTarget = ref<{ id: string } | null>(null)
const movePending = ref(false)
const showMoveDialog = computed({
  get: () => moveTarget.value !== null,
  set: (val: boolean) => { if (!val) moveTarget.value = null },
})

function handleDeleteRequest(docId: string) {
  const doc = documents.value?.find((d) => d._id === docId)
  if (doc) deleteTarget.value = { id: docId, filename: doc.filename }
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  try {
    await deleteDocument(deleteTarget.value.id as Id<'documents'>)
    const { toast } = await import('vue-sonner')
    toast.success('Document deleted')
  } catch (e: any) {
    const { toast } = await import('vue-sonner')
    toast.error(e.message || 'Failed to delete document')
  }
  deleteTarget.value = null
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
      class="flex flex-1 items-center justify-center text-muted-foreground"
    >
      <div class="text-center">
        <FileText class="mx-auto mb-3 h-12 w-12 opacity-40" />
        <p class="text-lg font-medium">Documents will appear here</p>
        <p class="mt-1 text-sm">Upload files to get started</p>
      </div>
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
          <UiAlertDialogAction class="bg-destructive text-destructive-foreground hover:bg-destructive/90" @click="confirmDelete">Delete</UiAlertDialogAction>
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
