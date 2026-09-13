<script setup lang="ts">
import { Layers, MoreHorizontal, Pencil, Trash2, ArrowLeft } from '@lucide/vue'
import { onClickOutside } from '@vueuse/core'

const props = defineProps<{
  title: string
  renaming?: boolean
  lastUpdated?: number | null
  cardCount?: number
}>()

const emit = defineEmits<{
  'update:title': [value: string]
  rename: [value: string]
  delete: []
  back: []
}>()

const editing = ref(false)
const draft = ref(props.title)
const inputRef = ref<HTMLInputElement | null>(null)
const menuOpen = ref(false)
const menuRef = ref<HTMLDivElement | null>(null)

watch(() => props.title, (next) => {
  if (!editing.value) draft.value = next
})

async function startEdit() {
  editing.value = true
  draft.value = props.title
  menuOpen.value = false
  await nextTick()
  inputRef.value?.focus()
  inputRef.value?.select()
}

function cancelEdit() {
  editing.value = false
  draft.value = props.title
}

function commit() {
  const trimmed = draft.value.trim()
  if (!editing.value) return
  editing.value = false
  if (trimmed && trimmed !== props.title) {
    emit('rename', trimmed)
  }
  else {
    draft.value = props.title
  }
}

function handleKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    commit()
  }
  else if (e.key === 'Escape') {
    e.preventDefault()
    cancelEdit()
  }
}

onClickOutside(menuRef, () => { menuOpen.value = false })

const formattedTimestamp = computed(() => {
  if (!props.lastUpdated) return ''
  try {
    return new Date(props.lastUpdated).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }
  catch {
    return ''
  }
})
</script>

<template>
  <div
    data-testid="flashcard-room-header"
    class="flex items-center justify-between gap-3 border-b border-border/60 bg-card/60 px-5 py-4"
  >
    <div class="flex min-w-0 items-center gap-3">
      <UiButton
        variant="ghost"
        size="icon"
        class="h-9 w-9 shrink-0"
        aria-label="Back to rooms"
        data-testid="flashcard-room-back"
        @click="emit('back')"
      >
        <ArrowLeft class="h-4 w-4" />
      </UiButton>
      <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Layers class="h-4 w-4" />
      </span>
      <div class="flex min-w-0 flex-col">
        <div v-if="!editing" class="flex items-center gap-2">
          <h2
            data-testid="flashcard-room-title"
            class="truncate font-dm-sans text-lg font-semibold text-foreground"
          >
            {{ props.title }}
          </h2>
          <button
            type="button"
            class="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Rename room"
            data-testid="flashcard-room-rename-trigger"
            @click="startEdit"
          >
            <Pencil class="h-3.5 w-3.5" />
          </button>
        </div>
        <input
          v-else
          ref="inputRef"
          v-model="draft"
          type="text"
          maxlength="120"
          data-testid="flashcard-room-title-input"
          class="min-w-0 rounded-md border border-primary/40 bg-background px-2 py-1 font-dm-sans text-lg font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @keydown="handleKey"
          @blur="commit"
        />
        <p class="mt-0.5 font-inter text-xs text-muted-foreground">
          <span>Flash Cards</span>
          <template v-if="typeof cardCount === 'number'">
            <span class="px-1">•</span>
            <span>{{ cardCount }} card{{ cardCount === 1 ? '' : 's' }}</span>
          </template>
          <template v-if="formattedTimestamp">
            <span class="px-1">•</span>
            <span>Updated {{ formattedTimestamp }}</span>
          </template>
        </p>
      </div>
    </div>

    <div ref="menuRef" class="relative">
      <UiButton
        variant="ghost"
        size="icon"
        class="h-9 w-9"
        aria-label="Room actions"
        data-testid="flashcard-room-menu-trigger"
        @click="menuOpen = !menuOpen"
      >
        <MoreHorizontal class="h-4 w-4" />
      </UiButton>

      <div
        v-if="menuOpen"
        data-testid="flashcard-room-menu"
        class="absolute right-0 top-full z-40 mt-1 w-44 overflow-hidden rounded-lg border border-border/60 bg-popover text-popover-foreground shadow-lg"
      >
        <button
          type="button"
          data-testid="flashcard-room-menu-rename"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-muted/60"
          @click="startEdit"
        >
          <Pencil class="h-4 w-4" /> Rename
        </button>
        <button
          type="button"
          data-testid="flashcard-room-menu-delete"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive transition hover:bg-destructive/10"
          @click="emit('delete'); menuOpen = false"
        >
          <Trash2 class="h-4 w-4" /> Delete room
        </button>
      </div>
    </div>
  </div>
</template>
