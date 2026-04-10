<script setup lang="ts">
const { messages, loading, error, chat, clearMessages } = useRag()

const query = ref('')
const selectedModel = ref('anthropic/claude-sonnet-4-5')
const showSources = ref<number | null>(null)

const models = [
  { label: 'Claude Sonnet 4.5', value: 'anthropic/claude-sonnet-4-5' },
  { label: 'Claude Haiku 3.5', value: 'anthropic/claude-3.5-haiku' },
  { label: 'GPT-4o', value: 'openai/gpt-4o' },
  { label: 'GPT-4o Mini', value: 'openai/gpt-4o-mini' },
  { label: 'Gemini 2.5 Flash', value: 'google/gemini-2.5-flash-preview' },
  { label: 'Llama 3.1 70B', value: 'meta-llama/llama-3.1-70b-instruct' },
  { label: 'DeepSeek V3', value: 'deepseek/deepseek-chat-v3-0324' },
  { label: 'Mistral Large', value: 'mistralai/mistral-large-latest' },
]

const chatContainer = ref<HTMLElement>()

async function handleSubmit() {
  if (!query.value.trim() || loading.value) return

  const q = query.value
  query.value = ''

  await chat(q, { model: selectedModel.value })

  nextTick(() => {
    chatContainer.value?.scrollTo({ top: chatContainer.value.scrollHeight, behavior: 'smooth' })
  })
}

function toggleSources(index: number) {
  showSources.value = showSources.value === index ? null : index
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center gap-2 border-b border-border px-4 py-2">
      <select
        v-model="selectedModel"
        class="rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
      >
        <option v-for="model in models" :key="model.value" :value="model.value">
          {{ model.label }}
        </option>
      </select>
      <button
        class="rounded-md border border-input px-3 py-1.5 text-sm text-muted-foreground transition hover:bg-accent/10 hover:text-foreground"
        @click="clearMessages"
      >
        Clear
      </button>
    </div>

    <div ref="chatContainer" class="flex-1 overflow-y-auto px-4 py-4">
      <div v-if="messages.length === 0" class="flex h-full items-center justify-center">
        <div class="text-center">
          <p class="text-lg text-muted-foreground">Ask a question about your documents</p>
          <p class="mt-1 text-sm text-muted-foreground/60">
            Powered by AI Search + {{ models.find(m => m.value === selectedModel)?.label }}
          </p>
        </div>
      </div>

      <div v-else class="mx-auto max-w-3xl space-y-4">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          :class="[
            'rounded-lg px-4 py-3',
            msg.role === 'user'
              ? 'ml-auto max-w-[80%] bg-secondary'
              : 'max-w-[90%] bg-card border border-border',
          ]"
        >
          <p class="whitespace-pre-wrap text-sm leading-relaxed">{{ msg.content }}</p>

          <div v-if="msg.sources?.length" class="mt-2">
            <button
              class="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              @click="toggleSources(i)"
            >
              {{ showSources === i ? 'Hide' : 'Show' }} {{ msg.sources.length }} sources
            </button>

            <div v-if="showSources === i" class="mt-2 space-y-2">
              <div
                v-for="(source, si) in msg.sources"
                :key="si"
                class="rounded border border-border bg-background p-2.5 text-xs"
              >
                <div class="mb-1 flex items-center justify-between text-muted-foreground">
                  <span>{{ source.attributes?.filename || source.attributes?.url || `Source ${si + 1}` }}</span>
                  <span>Score: {{ (source.score * 100).toFixed(0) }}%</span>
                </div>
                <p class="line-clamp-3 text-muted-foreground/80">{{ source.content }}</p>
              </div>
            </div>
          </div>
        </div>

        <div v-if="loading" class="max-w-[90%] rounded-lg border border-border bg-card px-4 py-3">
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            Searching documents and generating response...
          </div>
        </div>
      </div>
    </div>

    <div v-if="error" class="border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
      {{ error }}
    </div>

    <form class="border-t border-border px-4 py-4" @submit.prevent="handleSubmit">
      <div class="mx-auto flex max-w-3xl gap-2">
        <input
          v-model="query"
          type="text"
          placeholder="Ask a question..."
          class="flex-1 rounded-md border border-input bg-card px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-ring"
          :disabled="loading"
        />
        <button
          type="submit"
          class="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          :disabled="loading || !query.trim()"
        >
          Send
        </button>
      </div>
    </form>
  </div>
</template>
