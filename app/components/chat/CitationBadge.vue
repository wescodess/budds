<script setup lang="ts">
import { FileText, ExternalLink } from 'lucide-vue-next'

const props = defineProps<{
  index: number
  filename?: string
  score?: number
  content?: string
}>()

const emit = defineEmits<{
  click: [index: number]
  'open-in-knowledge': [index: number]
}>()

const hasHoverDetails = computed(() => Boolean(props.filename))
const scorePct = computed(() =>
  typeof props.score === 'number' ? `${Math.round(props.score * 100)}%` : null,
)
const excerpt = computed(() => {
  if (!props.content) return ''
  const normalized = props.content.replace(/\s+/g, ' ').trim()
  return normalized.length > 260 ? `${normalized.slice(0, 260)}…` : normalized
})
</script>

<template>
  <UiHoverCard v-if="hasHoverDetails" :open-delay="300" :close-delay="120">
    <UiHoverCardTrigger as-child>
      <button
        type="button"
        :aria-label="`Source ${props.index}${props.filename ? ` from ${props.filename}` : ''}`"
        class="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground align-baseline transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="emit('click', props.index)"
      >
        {{ props.index }}
      </button>
    </UiHoverCardTrigger>
    <UiHoverCardContent
      side="top"
      align="start"
      class="w-80 space-y-2 rounded-xl border bg-card p-4 text-foreground"
    >
      <div class="flex items-center gap-2">
        <FileText class="h-4 w-4 text-muted-foreground shrink-0" />
        <span class="truncate text-sm font-semibold">{{ props.filename }}</span>
      </div>
      <div v-if="scorePct" class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {{ scorePct }} relevance
      </div>
      <div
        v-if="excerpt"
        class="rounded-lg bg-primary/10 p-3 font-mono text-[13px] leading-[1.54] text-foreground/90"
      >
        {{ excerpt }}
      </div>
      <button
        type="button"
        class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        @click="emit('open-in-knowledge', props.index)"
      >
        Open in knowledge
        <ExternalLink class="h-3 w-3" />
      </button>
    </UiHoverCardContent>
  </UiHoverCard>
  <button
    v-else
    type="button"
    :aria-label="`Source ${props.index}`"
    class="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground align-baseline transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    @click="emit('click', props.index)"
  >
    {{ props.index }}
  </button>
</template>
