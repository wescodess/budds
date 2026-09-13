<script setup lang="ts">
import { onLongPress } from '@vueuse/core'
import { ArrowLeftRight, FileText, FileImage, Link as LinkIcon, Trash2, X } from '@lucide/vue'
import type { Id } from '~~/convex/_generated/dataModel'
import { LONG_PRESS_MOVE_PX, LONG_PRESS_MS, ROW_ACTION_WIDTH_PX, useGestureGuards } from '~/composables/useGestureGuards'

defineOptions({ name: 'FolderShellFileRow' })

type Status = 'processing' | 'indexing' | 'success' | 'failed' | 'pending'

const props = defineProps<{
  documentId: Id<'documents'> | string
  filename: string
  status: Status
  fileSize: number
  createdAt: number
  failureReason?: string
  variant?: 'panel' | 'list'
  selectable?: boolean
  selected?: boolean
  swipeOpen?: boolean
}>()

const emit = defineEmits<{
  open: [id: string]
  rename: [id: string]
  move: [id: string]
  download: [id: string]
  delete: [id: string]
  dismiss: [id: string]
  toggleSelect: [id: string]
  'swipe-open': [id: string]
  'swipe-close': [id: string]
  'long-press-select': [id: string]
}>()

const ext = computed(() => {
  const i = props.filename.lastIndexOf('.')
  return i >= 0 ? props.filename.slice(i + 1).toLowerCase() : ''
})

const icon = computed(() => {
  if (/^(png|jpe?g|gif|webp|svg)$/.test(ext.value)) return FileImage
  if (props.filename.startsWith('http://') || props.filename.startsWith('https://')) return LinkIcon
  return FileText
})

const subtitle = computed(() => {
  const size = props.fileSize >= 1_048_576
    ? `${(props.fileSize / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(props.fileSize / 1024))} KB`
  const type = ext.value ? ext.value.toUpperCase() : 'File'
  return `${type} · ${size}`
})

const dateLabel = computed(() => {
  const d = new Date(props.createdAt)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 86_400_000
  if (diff < 1 && d.getDate() === now.getDate()) {
    return `Today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  }
  if (diff < 2) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
})

const id = computed(() => props.documentId as unknown as string)
const isList = computed(() => props.variant === 'list')
const canAct = computed(() => props.status !== 'pending' && props.status !== 'failed')
const canDismiss = computed(() => props.status === 'failed')
const { isTouchLike } = useGestureGuards()
const rowRef = ref<HTMLElement | null>(null)
const showSwipeReveal = computed(() => isTouchLike.value && !props.selectable && (canAct.value || canDismiss.value))
const actionWidth = computed(() => canDismiss.value ? 64 : Math.min(ROW_ACTION_WIDTH_PX, 104))
const showInlineDismiss = computed(() => canDismiss.value && !showSwipeReveal.value)
const showKebabMenu = computed(() => !props.selectable && canAct.value && !showSwipeReveal.value)

function toggleSelection() {
  emit('toggleSelect', id.value)
}

function handleSwipeOpenChange(next: boolean) {
  if (next) emit('swipe-open', id.value)
  else emit('swipe-close', id.value)
}

onLongPress(
  rowRef,
  () => {
    if (!isTouchLike.value || props.selectable || !canAct.value) return
    emit('long-press-select', id.value)
  },
  {
    delay: LONG_PRESS_MS,
    distanceThreshold: LONG_PRESS_MOVE_PX,
  },
)
</script>

<template>
  <MobileSwipeRevealItem
    v-if="!isList"
    :open="props.swipeOpen"
    :disabled="!showSwipeReveal"
    :action-width="actionWidth"
    class="rounded-lg"
    content-class="rounded-lg"
    @update:open="handleSwipeOpenChange"
  >
    <template #actions>
      <button
        v-if="canDismiss"
        type="button"
        data-swipe-reveal-action
        :aria-label="`Dismiss ${filename}`"
        class="flex h-full w-full items-center justify-center bg-muted text-foreground"
        @click="emit('dismiss', id)"
      >
        <X class="h-4 w-4" />
      </button>
      <template v-else>
        <button
          type="button"
          data-swipe-reveal-action
          :aria-label="`Move ${filename}`"
          class="flex h-full w-1/2 items-center justify-center bg-muted text-foreground"
          @click="emit('move', id)"
        >
          <ArrowLeftRight class="h-4 w-4" />
        </button>
        <button
          type="button"
          data-swipe-reveal-action
          :aria-label="`Delete ${filename}`"
          class="flex h-full w-1/2 items-center justify-center bg-destructive text-destructive-foreground"
          @click="emit('delete', id)"
        >
          <Trash2 class="h-4 w-4" />
        </button>
      </template>
    </template>

    <div
      ref="rowRef"
      :class="[
        'group flex items-center gap-3 rounded-lg px-2 py-2 transition',
        selected ? 'bg-primary/10 ring-1 ring-primary/20' : 'hover:bg-muted/50',
      ]"
      :data-testid="`file-row-${id}`"
    >
      <UiCheckbox
        v-if="selectable && canAct"
        :model-value="selected"
        :aria-label="`Select ${filename}`"
        class="mt-0.5"
        :data-testid="`file-row-select-${id}`"
        @click.stop
        @update:model-value="toggleSelection"
      />
      <div class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-primary overflow-hidden">
        <div class="absolute inset-0 bg-primary opacity-10" />
        <component :is="icon" class="relative z-10 h-4 w-4" />
      </div>
      <button
        v-if="selectable && canAct"
        type="button"
        class="min-w-0 flex-1 text-left"
        @click="toggleSelection"
      >
        <p class="truncate text-sm font-medium text-foreground">{{ filename }}</p>
        <p class="truncate text-[11px] text-muted-foreground">{{ subtitle }}</p>
      </button>
      <div v-else class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-foreground">{{ filename }}</p>
        <p class="truncate text-[11px] text-muted-foreground">{{ subtitle }}</p>
      </div>
      <FolderShellFileStatusPill :status="status" :failure-reason="failureReason" />
      <button
        v-if="showInlineDismiss"
        type="button"
        class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
        :aria-label="`Clear ${filename}`"
        @click="emit('dismiss', id)"
      >
        <X class="h-4 w-4" />
      </button>
      <FolderShellFileKebabMenu
        v-if="showKebabMenu"
        :document-id="id"
        @open="emit('open', $event)"
        @rename="emit('rename', $event)"
        @move="emit('move', $event)"
        @download="emit('download', $event)"
        @delete="emit('delete', $event)"
      />
    </div>
  </MobileSwipeRevealItem>

  <MobileSwipeRevealItem
    v-else
    :open="props.swipeOpen"
    :disabled="!showSwipeReveal"
    :action-width="actionWidth"
    @update:open="handleSwipeOpenChange"
  >
    <template #actions>
      <button
        v-if="canDismiss"
        type="button"
        data-swipe-reveal-action
        :aria-label="`Dismiss ${filename}`"
        class="flex h-full w-full items-center justify-center bg-muted text-foreground"
        @click="emit('dismiss', id)"
      >
        <X class="h-4 w-4" />
      </button>
      <template v-else>
        <button
          type="button"
          data-swipe-reveal-action
          :aria-label="`Move ${filename}`"
          class="flex h-full w-1/2 items-center justify-center bg-muted text-foreground"
          @click="emit('move', id)"
        >
          <ArrowLeftRight class="h-4 w-4" />
        </button>
        <button
          type="button"
          data-swipe-reveal-action
          :aria-label="`Delete ${filename}`"
          class="flex h-full w-1/2 items-center justify-center bg-destructive text-destructive-foreground"
          @click="emit('delete', id)"
        >
          <Trash2 class="h-4 w-4" />
        </button>
      </template>
    </template>

    <div
      ref="rowRef"
      :class="[
        'group grid grid-cols-[minmax(0,1fr)_140px_140px_100px_32px] items-center gap-3 border-t border-border/40 px-4 py-3 text-sm transition',
        selected ? 'bg-primary/10 ring-1 ring-inset ring-primary/20' : 'hover:bg-muted/40',
      ]"
      :data-testid="`file-row-${id}`"
    >
      <div class="flex min-w-0 items-center gap-3">
        <UiCheckbox
          v-if="selectable && canAct"
          :model-value="selected"
          :aria-label="`Select ${filename}`"
          :data-testid="`file-row-select-${id}`"
          @click.stop
          @update:model-value="toggleSelection"
        />
        <div class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-primary overflow-hidden">
          <div class="absolute inset-0 bg-primary opacity-10" />
          <component :is="icon" class="relative z-10 h-4 w-4" />
        </div>
        <button
          v-if="selectable && canAct"
          type="button"
          class="min-w-0 flex-1 text-left"
          @click="toggleSelection"
        >
          <p class="truncate font-medium text-foreground">{{ filename }}</p>
          <p class="truncate text-[11px] text-muted-foreground">{{ subtitle }}</p>
        </button>
        <div v-else class="min-w-0">
          <p class="truncate font-medium text-foreground">{{ filename }}</p>
          <p class="truncate text-[11px] text-muted-foreground">{{ subtitle }}</p>
        </div>
      </div>
      <div class="flex justify-start">
        <FolderShellFileStatusPill :status="status" :failure-reason="failureReason" />
      </div>
      <div class="text-xs text-muted-foreground">{{ dateLabel }}</div>
      <div class="text-xs tabular-nums text-muted-foreground">
        {{ fileSize >= 1_048_576 ? (fileSize / 1_048_576).toFixed(1) + ' MB' : Math.max(1, Math.round(fileSize / 1024)) + ' KB' }}
      </div>
      <div class="flex justify-end">
        <button
          v-if="showInlineDismiss"
          type="button"
          class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          :aria-label="`Clear ${filename}`"
          @click="emit('dismiss', id)"
        >
          <X class="h-4 w-4" />
        </button>
        <FolderShellFileKebabMenu
          v-if="showKebabMenu"
          :document-id="id"
          @open="emit('open', $event)"
          @rename="emit('rename', $event)"
          @move="emit('move', $event)"
          @download="emit('download', $event)"
          @delete="emit('delete', $event)"
        />
      </div>
    </div>
  </MobileSwipeRevealItem>
</template>
