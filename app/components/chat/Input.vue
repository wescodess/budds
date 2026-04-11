<script setup lang="ts">
import { Send } from 'lucide-vue-next'

defineProps<{
  disabled?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{
  submit: [message: string]
}>()

const input = ref('')
const textareaRef = ref<HTMLTextAreaElement>()

const canSubmit = computed(() => input.value.trim().length > 0)

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
  <div class="flex items-end gap-2 border-t p-4">
    <textarea
      ref="textareaRef"
      v-model="input"
      :disabled="disabled"
      :placeholder="placeholder ?? 'Ask a question...'"
      rows="1"
      class="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      @keydown="handleKeydown"
      @input="resize"
    />
    <button
      :disabled="disabled || !canSubmit"
      class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      @click="handleSubmit"
    >
      <Send class="h-4 w-4" />
    </button>
  </div>
</template>
