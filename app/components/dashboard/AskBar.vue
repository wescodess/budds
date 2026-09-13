<script setup lang="ts">
import { Send, Sparkles } from '@lucide/vue'

const router = useRouter()
const query = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

function submit() {
  const q = query.value.trim()
  if (!q) return
  query.value = ''
  void router.push({ path: '/chat', query: { q } })
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="pointer-events-none sticky bottom-0 z-20 mt-auto flex w-full shrink-0 flex-col items-center gap-1 overflow-x-hidden bg-gradient-to-t from-background via-background to-transparent px-4 pb-4 pt-6">
    <p class="pointer-events-auto font-inter text-[11px] text-muted-foreground">
      General chat — not tied to a course
    </p>
    <form
      class="pointer-events-auto flex min-w-0 w-full max-w-2xl items-center gap-2 rounded-xl border border-input bg-card px-3 py-2 shadow-sm focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-ring"
      data-testid="dashboard-ask-bar"
      @submit.prevent="submit"
    >
      <Sparkles class="h-4 w-4 shrink-0 text-primary" />
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        aria-label="Ask Budds anything"
        placeholder="Ask Budds anything…"
        inputmode="text"
        enterkeyhint="send"
        autocapitalize="sentences"
        autocorrect="on"
        spellcheck="true"
        class="h-8 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        @keydown="onKeydown"
      />
      <button
        type="submit"
        :disabled="!query.trim()"
        aria-label="Send"
        class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
      >
        <Send class="h-3.5 w-3.5" />
      </button>
    </form>
  </div>
</template>
