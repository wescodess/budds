<script setup lang="ts">
import { getModelLabel } from '~/constants/models'

const props = defineProps<{
  model?: string
}>()

const label = computed(() => (props.model ? getModelLabel(props.model) : null))

const { springGentle } = useMotionPresets()
</script>

<template>
  <Motion
    :initial="{ opacity: 0, x: -8 }"
    :animate="{ opacity: 1, x: 0 }"
    :transition="springGentle"
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
      <Motion
        v-for="i in 3"
        :key="i"
        as="span"
        :animate="{ scale: [1, 1.4, 1] }"
        :transition="{ duration: 0.6, repeat: Infinity, delay: (i - 1) * 0.15 }"
        class="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground"
      />
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
  </Motion>
</template>
