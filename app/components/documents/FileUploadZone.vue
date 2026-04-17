<script setup lang="ts">
import { Upload } from 'lucide-vue-next'
import type { Id } from '~~/convex/_generated/dataModel'

defineOptions({ name: 'FileUploadZone' })

const MAX_FILE_SIZE = 52_428_800
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'docx', 'xlsx', 'txt', 'md', 'csv', 'html', 'png', 'jpg', 'jpeg', 'webp', 'gif',
])

function isAllowedFile(file: File): boolean {
  if (ALLOWED_MIME_TYPES.has(file.type)) return true
  const ext = file.name.split('.').pop()?.toLowerCase()
  return ext ? ALLOWED_EXTENSIONS.has(ext) : false
}

const props = defineProps<{
  folderId: Id<'folders'>
  disabled?: boolean
}>()

const emit = defineEmits<{
  upload: [files: File[]]
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const isDragOver = ref(false)

function openFilePicker() {
  if (props.disabled) return
  fileInputRef.value?.click()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    openFilePicker()
  }
}

function validateAndEmit(fileList: FileList | null) {
  if (!fileList || fileList.length === 0) return

  const valid: File[] = []
  const rejected: string[] = []

  for (const file of Array.from(fileList)) {
    if (!isAllowedFile(file)) {
      rejected.push(`${file.name}: Unsupported file type`)
    } else if (file.size > MAX_FILE_SIZE) {
      rejected.push(`${file.name}: File exceeds 50MB limit`)
    } else {
      valid.push(file)
    }
  }

  if (rejected.length > 0) {
    import('vue-sonner').then(({ toast }) => {
      rejected.forEach((msg) => toast.error(msg))
    })
  }

  if (valid.length > 0) {
    emit('upload', valid)
  }

  if (fileInputRef.value) {
    fileInputRef.value.value = ''
  }
}

function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  validateAndEmit(input.files)
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  if (props.disabled) return
  validateAndEmit(e.dataTransfer?.files ?? null)
}

function handleDragOver(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = true
}

function handleDragLeave() {
  isDragOver.value = false
}
</script>

<template>
  <div>
    <UiButton
      variant="outline"
      :disabled="disabled"
      class="w-full sm:hidden"
      aria-label="Upload files"
      @click="openFilePicker"
    >
      <Upload class="mr-2 h-4 w-4" />
      Upload files
    </UiButton>

    <div
      role="button"
      tabindex="0"
      aria-label="Upload files"
      :aria-disabled="disabled ? 'true' : undefined"
      :class="[
        'hidden cursor-pointer flex-col items-center justify-center rounded-lg border-2 p-6 transition-colors sm:flex',
        isDragOver && !disabled ? 'border-solid border-primary bg-primary/5' : 'border-dashed border-muted-foreground/25',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-muted-foreground/50',
      ]"
      @click="openFilePicker"
      @keydown="handleKeydown"
      @drop="handleDrop"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
    >
      <Upload class="mb-2 h-8 w-8 text-muted-foreground" />
      <p class="text-sm text-muted-foreground">
        Drag files here or <span class="font-medium text-primary underline">browse</span>
      </p>
    </div>

    <input
      ref="fileInputRef"
      type="file"
      accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx,text/plain,.txt,text/markdown,.md,text/csv,.csv,text/html,.html,image/png,.png,image/jpeg,.jpg,.jpeg,image/webp,.webp,image/gif,.gif"
      multiple
      class="hidden"
      @change="handleFileChange"
    />
  </div>
</template>
