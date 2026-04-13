<script setup lang="ts">
import { Send, Sparkles } from 'lucide-vue-next'
import { MODELS, DEFAULT_MODEL } from '~/constants/models'

const route = useRoute()
const router = useRouter()

const { messages, loading, error, send } = useGeneralChat()
const selectedModel = ref(DEFAULT_MODEL)
const query = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)
const scrollRef = ref<HTMLElement | null>(null)

async function handleSend(text: string) {
  const trimmed = text.trim()
  if (!trimmed || loading.value) return
  query.value = ''
  try {
    await send(trimmed, selectedModel.value)
  }
  catch {
    // error surfaced in `error` ref
  }
  nextTick(() => {
    scrollRef.value?.scrollTo({ top: scrollRef.value.scrollHeight, behavior: 'smooth' })
  })
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void handleSend(query.value)
  }
}

onMounted(async () => {
  const initial = route.query.q
  if (typeof initial === 'string' && initial.trim()) {
    await router.replace({ path: '/chat', query: {} })
    await handleSend(initial)
  }
})

watch(() => messages.value.length, () => {
  nextTick(() => {
    scrollRef.value?.scrollTo({ top: scrollRef.value.scrollHeight, behavior: 'smooth' })
  })
})
</script>

<template>
  <div class="flex flex-1 flex-col overflow-hidden">
    <div class="flex items-center justify-between border-b border-border px-4 py-2">
      <div class="flex items-center gap-2">
        <Sparkles class="h-4 w-4 text-primary" />
        <span class="font-dm-sans text-sm font-semibold text-foreground">General Chat</span>
        <span class="text-xs text-muted-foreground">· not tied to a course</span>
      </div>
      <select
        v-model="selectedModel"
        aria-label="Model"
        class="rounded-md border border-input bg-card px-2 py-1 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring"
      >
        <option v-for="m in MODELS" :key="m.value" :value="m.value">{{ m.label }}</option>
      </select>
    </div>

    <div ref="scrollRef" role="log" aria-live="polite" class="flex-1 space-y-4 overflow-y-auto p-4">
      <div v-if="messages.length === 0" class="flex h-full items-center justify-center text-center text-muted-foreground">
        <div>
          <Sparkles class="mx-auto mb-3 h-10 w-10 text-primary opacity-60" />
          <p class="font-dm-sans text-lg font-semibold text-foreground">Ask anything</p>
          <p class="mt-1 text-sm">General study help, no course needed.</p>
        </div>
      </div>

      <div
        v-for="(msg, i) in messages"
        :key="i"
        :class="[
          'max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap',
          msg.role === 'user' ? 'ml-auto bg-muted' : 'mr-auto border border-border bg-card',
        ]"
      >
        {{ msg.content }}
      </div>

      <div v-if="loading" class="mr-auto max-w-[85%] rounded-lg border border-border bg-card px-4 py-3">
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <div class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Thinking…
        </div>
      </div>

      <p v-if="error" class="text-center text-sm text-destructive">{{ error }}</p>
    </div>

    <form class="flex items-end gap-2 border-t border-border p-4" @submit.prevent="handleSend(query)">
      <textarea
        ref="inputRef"
        v-model="query"
        rows="1"
        aria-label="Ask Budds anything"
        placeholder="Ask Budds anything…"
        :disabled="loading"
        class="flex-1 resize-none rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @keydown="onKeydown"
      />
      <button
        type="submit"
        :disabled="loading || !query.trim()"
        aria-label="Send"
        class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
      >
        <Send class="h-4 w-4" />
      </button>
    </form>
  </div>
</template>
