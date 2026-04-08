<script setup lang="ts">
definePageMeta({ layout: false })

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
  <div class="flex h-screen flex-col bg-zinc-950 text-zinc-100">
    <header class="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
      <h1 class="text-lg font-semibold">RAG Chat</h1>
      <div class="flex items-center gap-3">
        <select
          v-model="selectedModel"
          class="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-zinc-500"
        >
          <option v-for="model in models" :key="model.value" :value="model.value">
            {{ model.label }}
          </option>
        </select>
        <button
          class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          @click="clearMessages"
        >
          Clear
        </button>
      </div>
    </header>

    <div ref="chatContainer" class="flex-1 overflow-y-auto px-6 py-4">
      <div v-if="messages.length === 0" class="flex h-full items-center justify-center">
        <div class="text-center">
          <p class="text-lg text-zinc-500">Ask a question about your documents</p>
          <p class="mt-1 text-sm text-zinc-600">Powered by AI Search + {{ models.find(m => m.value === selectedModel)?.label }}</p>
        </div>
      </div>

      <div v-else class="mx-auto max-w-3xl space-y-4">
        <div
          v-for="(msg, i) in messages"
          :key="i"
          :class="[
            'rounded-lg px-4 py-3',
            msg.role === 'user'
              ? 'ml-auto max-w-[80%] bg-zinc-800'
              : 'max-w-[90%] bg-zinc-900 border border-zinc-800',
          ]"
        >
          <p class="whitespace-pre-wrap text-sm leading-relaxed">{{ msg.content }}</p>

          <div v-if="msg.sources?.length" class="mt-2">
            <button
              class="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
              @click="toggleSources(i)"
            >
              {{ showSources === i ? 'Hide' : 'Show' }} {{ msg.sources.length }} sources
            </button>

            <div v-if="showSources === i" class="mt-2 space-y-2">
              <div
                v-for="(source, si) in msg.sources"
                :key="si"
                class="rounded border border-zinc-700 bg-zinc-950 p-2.5 text-xs"
              >
                <div class="mb-1 flex items-center justify-between text-zinc-500">
                  <span>{{ source.attributes?.filename || source.attributes?.url || `Source ${si + 1}` }}</span>
                  <span>Score: {{ (source.score * 100).toFixed(0) }}%</span>
                </div>
                <p class="line-clamp-3 text-zinc-400">{{ source.content }}</p>
              </div>
            </div>
          </div>
        </div>

        <div v-if="loading" class="max-w-[90%] rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
          <div class="flex items-center gap-2 text-sm text-zinc-500">
            <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500" />
            Searching documents and generating response...
          </div>
        </div>
      </div>
    </div>

    <div v-if="error" class="border-t border-red-900 bg-red-950/50 px-6 py-2 text-sm text-red-400">
      {{ error }}
    </div>

    <form class="border-t border-zinc-800 px-6 py-4" @submit.prevent="handleSubmit">
      <div class="mx-auto flex max-w-3xl gap-2">
        <input
          v-model="query"
          type="text"
          placeholder="Ask a question..."
          class="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
          :disabled="loading"
        />
        <button
          type="submit"
          class="rounded-md bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 transition hover:bg-zinc-200 disabled:opacity-50"
          :disabled="loading || !query.trim()"
        >
          Send
        </button>
      </div>
    </form>
  </div>
</template>
