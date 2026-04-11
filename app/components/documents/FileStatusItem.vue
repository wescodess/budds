<script setup lang="ts">
import { Loader2, CheckCircle2, XCircle } from 'lucide-vue-next'

defineOptions({ name: 'FileStatusItem' })

defineProps<{
  filename: string
  status: 'processing' | 'success' | 'failed'
  fileSize: number
  createdAt: number
  failureReason?: string
}>()

function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) {
    return `${Math.round(bytes / 1_048_576)} MB`
  }
  return `${Math.round(bytes / 1024)} KB`
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString()
}
</script>

<template>
  <div class="flex items-center gap-3 rounded-lg border px-4 py-3">
    <div class="shrink-0">
      <Loader2 v-if="status === 'processing'" class="h-5 w-5 animate-spin text-amber-500" />
      <CheckCircle2 v-else-if="status === 'success'" class="h-5 w-5 text-green-500" />
      <XCircle v-else class="h-5 w-5 text-red-500" />
    </div>

    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium">{{ filename }}</p>
      <div aria-live="polite" class="text-xs text-muted-foreground">
        <template v-if="status === 'processing'">
          {{ formatFileSize(fileSize) }} · Processing...
        </template>
        <template v-else-if="status === 'success'">
          {{ formatFileSize(fileSize) }} · {{ formatDate(createdAt) }}
        </template>
        <template v-else>
          {{ failureReason || 'Processing failed' }}
        </template>
      </div>
    </div>
  </div>
</template>
