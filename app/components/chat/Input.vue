<script setup lang="ts">
import { Send, Paperclip } from 'lucide-vue-next'
import type { Id } from '../../../convex/_generated/dataModel'
import type { useReferenceScope } from '~/composables/useReferenceScope'

const props = defineProps<{
  disabled?: boolean
  placeholder?: string
  folderId?: Id<'folders'>
  scope?: ReturnType<typeof useReferenceScope>
}>()

const emit = defineEmits<{
  submit: [message: string]
}>()

const input = ref('')
const textareaRef = ref<HTMLTextAreaElement>()
const pickerOpen = ref(false)

const canSubmit = computed(() => input.value.trim().length > 0)
const scopeCount = computed(() => props.scope?.totalFileCount.value ?? 0)

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSubmit()
  }
}

function handleSubmit() {
  const trimmed = input.value.trim()
  if (!trimmed) return
  emit('submit', trimmed)
  input.value = ''
  nextTick(() => resize())
}

function resize() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  const lineHeight = parseInt(getComputedStyle(el).lineHeight) || 20
  const maxHeight = lineHeight * 4
  el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
}

function focus() {
  textareaRef.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div class="border-t p-4">
    <ChatReferenceScopeStrip v-if="props.scope" :scope="props.scope" />
    <div class="flex items-end gap-2">
      <UiPopover v-if="props.scope && props.folderId" v-model:open="pickerOpen">
        <UiPopoverTrigger as-child>
          <button
            type="button"
            :aria-label="scopeCount > 0 ? `Reference scope (${scopeCount} files)` : 'Add reference scope'"
            :data-active="scopeCount > 0 || undefined"
            class="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-active:border-primary data-active:text-primary"
          >
            <Paperclip class="h-4 w-4" />
            <span
              v-if="scopeCount > 0"
              class="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
            >
              {{ scopeCount }}
            </span>
          </button>
        </UiPopoverTrigger>
        <UiPopoverContent side="top" align="start" class="w-auto border-none bg-transparent p-0 shadow-none">
          <ChatDirectoryPicker
            :folder-id="props.folderId"
            :scope="props.scope"
            @close="pickerOpen = false"
          />
        </UiPopoverContent>
      </UiPopover>
      <textarea
        ref="textareaRef"
        v-model="input"
        :disabled="disabled"
        :placeholder="placeholder ?? 'Ask a question...'"
        rows="1"
        class="flex-1 resize-none rounded-xl border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        @keydown="handleKeydown"
        @input="resize"
      />
      <button
        :disabled="disabled || !canSubmit"
        class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
        @click="handleSubmit"
      >
        <Send class="h-4 w-4" />
      </button>
    </div>
  </div>
</template>
