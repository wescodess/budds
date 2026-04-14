<script setup lang="ts">
import { Upload } from 'lucide-vue-next'
import type { Id } from '~~/convex/_generated/dataModel'

defineOptions({ name: 'FileUploadZone' })

const MAX_FILE_SIZE = 52_428_800

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
    if (file.type !== 'application/pdf') {
      rejected.push(`${file.name}: Only PDF files are supported`)
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
      aria-label="Upload PDF files"
      @click="openFilePicker"
    >
      <Upload class="mr-2 h-4 w-4" />
      Upload PDFs
    </UiButton>

    <div
      role="button"
      tabindex="0"
      aria-label="Upload PDF files"
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
        Drag PDFs here or <span class="font-medium text-primary underline">browse</span>
      </p>
    </div>

    <input
      ref="fileInputRef"
      type="file"
      accept="application/pdf"
      multiple
      class="hidden"
      @change="handleFileChange"
    />
  </div>
</template>
