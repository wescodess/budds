<script setup lang="ts">
import { getModelLabel } from '~/constants/models'

const props = defineProps<{
  model?: string
}>()

const label = computed(() => (props.model ? getModelLabel(props.model) : null))
</script>

<template>
  <div
    data-testid="chat-thinking-row"
    role="status"
    aria-live="polite"
    :aria-label="`Assistant is thinking${label ? ` with ${label}` : ''}`"
    class="mr-auto flex w-full items-center gap-3 rounded-lg border border-transparent px-4 py-3 text-sm"
  >
    <span
      aria-hidden="true"
      class="inline-flex items-center gap-1 motion-reduce:hidden"
    >
      <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
      <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
      <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
    </span>
    <span
      aria-hidden="true"
      class="hidden h-1.5 w-1.5 rounded-full bg-muted-foreground motion-reduce:inline-block"
    />
    <span class="text-muted-foreground">Thinking…</span>
    <span
      v-if="label"
      class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70"
    >
      · {{ label }} · reasoning
    </span>
  </div>
</template>
