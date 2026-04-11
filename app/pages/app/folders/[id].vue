<script setup lang="ts">
import { FolderPlus, FileText } from 'lucide-vue-next'
import type { Id } from '~~/convex/_generated/dataModel'

const route = useRoute()
const folderId = computed(() => route.params.id as Id<'folders'>)

const { folder } = useFolderDetail(folderId)
const { allFolders, createSubfolder } = useFolders()
const { documents, uploading, uploadFiles } = useDocuments(folderId)

const showNewSubfolder = ref(false)
const newSubfolderName = ref('')

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
  </div>
</template>
